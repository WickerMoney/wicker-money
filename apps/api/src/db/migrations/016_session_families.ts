import { sql, type Kysely } from 'kysely'
import { appRole } from './005_app_role.js'
import {
  addColumnIfMissing,
  addConstraintIfMissing,
  createIndexIfMissing,
  dropConstraintIfExists,
} from './support/index.js'

/**
 * @module
 * Session families, atomic refresh-token rotation, live session checks and
 * session purging.
 *
 * A refresh token is single-use: rotating it revokes the presented row and
 * inserts a successor. All rows produced by one login share a `family_id`, so
 * presenting an already-revoked token (a replay, which means a copy of the
 * token exists somewhere it should not) can end the whole chain at once. The
 * family id is also the `sid` claim of access tokens, so revoking a family
 * makes every access token issued under it stop working immediately.
 *
 * Every function below is SECURITY DEFINER because it runs before a user
 * context exists (or, for purging, without one). They rely on the sessions
 * table not having FORCE ROW LEVEL SECURITY, exactly as the other
 * pre-authentication functions do, and each pins its `search_path`.
 */

/** Functions created here, with their argument signatures, in creation order. */
const FUNCTIONS = [
  'core.rotate_refresh_token(text, text, timestamptz)',
  'core.revoke_session_family(text)',
  'core.session_is_active(uuid)',
  'core.purge_expired_sessions(interval)',
] as const

/**
 * Adds `family_id`, the supporting indexes and the four session functions.
 *
 * Safe to re-run: steps already done are skipped, and the functions are
 * replaced in place. The column is added nullable and made NOT NULL last, in a
 * way that does not rescan the table under an exclusive lock (see below).
 *
 * @param db - Migration connection (database owner).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  const role = sql.raw(appRole())

  await addColumnIfMissing(db, 'core.sessions', 'family_id', 'uuid')

  const { rows } = await sql<{ has_default: boolean; not_null: boolean }>`
    SELECT atthasdef AS has_default, attnotnull AS not_null
    FROM pg_attribute
    WHERE attrelid = 'core.sessions'::regclass AND attname = 'family_id'
  `.execute(db)
  const column = rows[0]

  // The default goes on before the backfill so a session created meanwhile is
  // never left without a family.
  if (column?.has_default !== true) {
    await sql`ALTER TABLE core.sessions ALTER COLUMN family_id SET DEFAULT gen_random_uuid()`.execute(db)
  }

  if (column?.not_null !== true) {
    // Existing sessions each become a one-row family of their own. A single
    // set-based statement: an interrupted run leaves some rows done, and the
    // NULL filter makes the next run pick up exactly the rest.
    await sql`UPDATE core.sessions SET family_id = id WHERE family_id IS NULL`.execute(db)

    // SET NOT NULL scans the table under an exclusive lock unless a validated
    // CHECK already proves it. The CHECK is validated with a lighter lock,
    // after which SET NOT NULL is a catalog change, and the CHECK is redundant.
    await addConstraintIfMissing(
      db,
      'core.sessions',
      'ck_sessions_family_id_present',
      'CHECK (family_id IS NOT NULL)',
    )
    await sql`ALTER TABLE core.sessions ALTER COLUMN family_id SET NOT NULL`.execute(db)
    await dropConstraintIfExists(db, 'core.sessions', 'ck_sessions_family_id_present')
  }

  // Serves session_is_active (one probe per authenticated request) and family revocation.
  await createIndexIfMissing(
    db,
    'core.ix_sessions_family_active',
    'ON core.sessions (family_id) WHERE revoked_at IS NULL',
  )
  await createIndexIfMissing(db, 'core.ix_sessions_expires_at', 'ON core.sessions (expires_at)')
  await createIndexIfMissing(
    db,
    'core.ix_sessions_revoked_at',
    'ON core.sessions (revoked_at) WHERE revoked_at IS NOT NULL',
  )

  // Revoking the presented token and inserting its successor happen in one
  // function, so a family never has a moment with no live token (which would
  // reject access tokens issued under it mid-rotation). The revoke is a single
  // conditional UPDATE: of two concurrent callers presenting the same token
  // exactly one matches, because the other blocks on the row lock and then
  // re-evaluates `revoked_at IS NULL` against the committed row. Parameters are
  // cast to char(64) so the comparison stays on the unique index; against
  // `text` it would compare as text and scan.
  await sql`
    CREATE OR REPLACE FUNCTION core.rotate_refresh_token(
      p_token_hash text, p_new_token_hash text, p_new_expires_at timestamptz
    )
    RETURNS TABLE (session_id uuid, user_id uuid, family_id uuid, email varchar, timezone text)
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = core, pg_temp
    AS $$
    #variable_conflict use_column
    DECLARE
      v_session uuid;
      v_user uuid;
      v_family uuid;
    BEGIN
      UPDATE core.sessions s
      SET revoked_at = now()
      WHERE s.token_hash = p_token_hash::char(64)
        AND s.revoked_at IS NULL
        AND s.expires_at > now()
      RETURNING s.id, s.user_id, s.family_id INTO v_session, v_user, v_family;

      IF NOT FOUND THEN
        RETURN;
      END IF;

      INSERT INTO core.sessions (user_id, family_id, token_hash, expires_at)
      VALUES (v_user, v_family, p_new_token_hash::char(64), p_new_expires_at);

      RETURN QUERY
      SELECT v_session, v_user, v_family, u.email, u.timezone
      FROM core.users u
      WHERE u.id = v_user;
    END
    $$
  `.execute(db)

  await sql`
    CREATE OR REPLACE FUNCTION core.revoke_session_family(p_token_hash text)
    RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = core, pg_temp
    AS $$
    DECLARE
      v_family uuid;
    BEGIN
      SELECT s.family_id INTO v_family
      FROM core.sessions s
      WHERE s.token_hash = p_token_hash::char(64);

      IF v_family IS NULL THEN
        RETURN false;
      END IF;

      UPDATE core.sessions s
      SET revoked_at = now()
      WHERE s.family_id = v_family AND s.revoked_at IS NULL;
      RETURN true;
    END
    $$
  `.execute(db)

  await sql`
    CREATE OR REPLACE FUNCTION core.session_is_active(p_family_id uuid)
    RETURNS boolean
    LANGUAGE sql SECURITY DEFINER STABLE SET search_path = core, pg_temp
    AS $$
      SELECT EXISTS (
        SELECT 1 FROM core.sessions s
        WHERE s.family_id = p_family_id
          AND s.revoked_at IS NULL
          AND s.expires_at > now()
      )
    $$
  `.execute(db)

  await sql`
    CREATE OR REPLACE FUNCTION core.purge_expired_sessions(p_retain interval)
    RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = core, pg_temp
    AS $$
    DECLARE
      v_deleted bigint;
    BEGIN
      DELETE FROM core.sessions s
      WHERE s.expires_at < now() - p_retain
         OR s.revoked_at < now() - p_retain;
      GET DIAGNOSTICS v_deleted = ROW_COUNT;
      RETURN v_deleted;
    END
    $$
  `.execute(db)

  for (const fn of FUNCTIONS) {
    await sql`REVOKE ALL ON FUNCTION ${sql.raw(fn)} FROM PUBLIC`.execute(db)
    await sql`GRANT EXECUTE ON FUNCTION ${sql.raw(fn)} TO ${role}`.execute(db)
  }
}

/**
 * Tells the migrator to run this migration without wrapping it in a
 * transaction, so the constraint scan and the index builds hold their locks
 * alone. Every step is idempotent.
 */
export const transactional = false

/**
 * Drops the functions, indexes and the `family_id` column.
 *
 * @param db - Migration connection (database owner).
 */
export async function down(db: Kysely<unknown>): Promise<void> {
  for (const fn of [...FUNCTIONS].reverse()) {
    await sql`DROP FUNCTION IF EXISTS ${sql.raw(fn)}`.execute(db)
  }
  await sql`DROP INDEX IF EXISTS core.ix_sessions_revoked_at`.execute(db)
  await sql`DROP INDEX IF EXISTS core.ix_sessions_expires_at`.execute(db)
  await sql`DROP INDEX IF EXISTS core.ix_sessions_family_active`.execute(db)
  await sql`ALTER TABLE core.sessions DROP COLUMN IF EXISTS family_id`.execute(db)
}
