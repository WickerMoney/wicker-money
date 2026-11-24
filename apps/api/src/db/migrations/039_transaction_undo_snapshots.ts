import { sql, type Kysely } from 'kysely'
import { appRole } from './005_app_role.js'
import { createIndexIfMissing, ensurePolicy, ensureRowSecurity } from './support/index.js'

/**
 * @module
 * Undo for a deleted transaction (ADR 0016): a short-lived copy of what a
 * delete removed, which one request can put back.
 *
 * `core.transaction_undo_snapshots` holds one row per delete: the transaction
 * (or both legs of a transfer), its splits and its match dismissals, each as
 * `to_jsonb(row)`, plus an expiry. The delete route writes it before it deletes
 * and the restore route inserts the rows again with their original ids and
 * timestamps. Nothing in `core.transactions` or any plugin schema changes.
 *
 * **The payload is built and read back in SQL only.** `to_jsonb` keeps a
 * `numeric(19,4)` as an arbitrary-precision JSON number and
 * `jsonb_populate_recordset` casts it back to `numeric(19,4)`, so no amount
 * ever passes through a JavaScript number.
 *
 * **Row-level security.** ENABLE and FORCE, with the isolation policy in the
 * scalar-subquery form `rls-invariants` requires. No GRANT: migration 005's
 * default privileges give the application role DML on every new `core` table.
 *
 * **Purging under FORCE.** FORCE removes the owner's exemption, and a
 * `SECURITY DEFINER` function runs as the owner with no tenant context, so
 * the isolation policy shows it no row. The table is therefore not on the
 * `rls-invariants` allow-list; instead two extra permissive policies are scoped
 * `TO CURRENT_USER` (the role running this migration, which is the role that
 * owns the table and the function): `FOR SELECT` and `FOR DELETE`, both
 * `USING (expires_at < now())`. A DELETE with a WHERE clause needs the SELECT
 * policy as well as the DELETE one. The application role is not the owner, so
 * neither policy applies to it: through the API a person still sees only their
 * own rows, and the function can read and delete only rows that have expired.
 * `core.purge_expired_transaction_undos()` is `SECURITY DEFINER`, pins its
 * `search_path`, and only the application role may execute it, like
 * `core.purge_expired_sessions` (migration 016).
 *
 * The size check keeps one snapshot at or under 256 KiB of JSON text. The
 * delete route measures the payload first and writes no snapshot above that,
 * so the check is a guard and not an expected path (a transaction may have at
 * most 100 splits, which is far below it).
 *
 * Every step checks before it acts, so a re-run changes nothing and takes no
 * lock on a tenant table.
 */

const TABLE = 'core.transaction_undo_snapshots'
const FUNCTION = 'core.purge_expired_transaction_undos()'
const ISOLATION_POLICY = 'transaction_undo_snapshots_isolation'
const PURGE_SELECT_POLICY = 'transaction_undo_snapshots_purge_select'
const PURGE_DELETE_POLICY = 'transaction_undo_snapshots_purge_delete'

/** Largest snapshot payload, in bytes of its JSON text (256 KiB). A migration is frozen, so the number is written here and not imported. */
const UNDO_PAYLOAD_MAX_BYTES = 262_144

/** Whether a policy of this name exists on the table. */
async function policyExists(db: Kysely<unknown>, name: string): Promise<boolean> {
  const { rows } = await sql<{ found: boolean }>`
    SELECT EXISTS (
      SELECT 1 FROM pg_policy WHERE polrelid = to_regclass(${TABLE}) AND polname = ${name}
    ) AS found
  `.execute(db)
  return rows[0]?.found === true
}

/**
 * Creates the table, its index, row-level security, the owner-only purge
 * policies and the purge function.
 *
 * @param db - Migration connection (database owner).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  const exists = await sql<{ found: boolean }>`SELECT to_regclass(${TABLE}) IS NOT NULL AS found`.execute(db)
  if (exists.rows[0]?.found !== true) {
    await sql`
      CREATE TABLE core.transaction_undo_snapshots (
        id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id           uuid NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
        kind              text NOT NULL,
        payload           jsonb NOT NULL,
        transaction_count smallint NOT NULL,
        created_at        timestamptz NOT NULL DEFAULT now(),
        expires_at        timestamptz NOT NULL,
        restored_at       timestamptz,
        CONSTRAINT ck_transaction_undo_snapshots_kind CHECK (kind IN ('transaction', 'transfer')),
        CONSTRAINT ck_transaction_undo_snapshots_count CHECK (transaction_count IN (1, 2)),
        CONSTRAINT ck_transaction_undo_snapshots_payload_size
          CHECK (octet_length(payload::text) <= ${sql.lit(UNDO_PAYLOAD_MAX_BYTES)})
      )
    `.execute(db)
  }
  // Serves the lazy purge and the per-user cap.
  await createIndexIfMissing(
    db,
    'core.ix_transaction_undo_snapshots_user_expires',
    `ON ${TABLE} (user_id, expires_at)`,
  )
  await ensureRowSecurity(db, TABLE, true)
  await ensurePolicy(db, TABLE, ISOLATION_POLICY, 'user_id = (SELECT core.current_user_id())')

  // Owner only: see the module comment. CURRENT_USER is read when the policy is
  // created, so no role name is written into the migration.
  if (!(await policyExists(db, PURGE_SELECT_POLICY))) {
    await sql`
      CREATE POLICY ${sql.raw(PURGE_SELECT_POLICY)} ON ${sql.raw(TABLE)}
        AS PERMISSIVE FOR SELECT TO CURRENT_USER USING (expires_at < now())
    `.execute(db)
  }
  if (!(await policyExists(db, PURGE_DELETE_POLICY))) {
    await sql`
      CREATE POLICY ${sql.raw(PURGE_DELETE_POLICY)} ON ${sql.raw(TABLE)}
        AS PERMISSIVE FOR DELETE TO CURRENT_USER USING (expires_at < now())
    `.execute(db)
  }

  await sql`
    CREATE OR REPLACE FUNCTION core.purge_expired_transaction_undos()
    RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = core, pg_temp
    AS $$
    DECLARE
      v_deleted bigint;
    BEGIN
      DELETE FROM core.transaction_undo_snapshots s WHERE s.expires_at < now();
      GET DIAGNOSTICS v_deleted = ROW_COUNT;
      RETURN v_deleted;
    END
    $$
  `.execute(db)
  await sql`REVOKE ALL ON FUNCTION ${sql.raw(FUNCTION)} FROM PUBLIC`.execute(db)
  await sql`GRANT EXECUTE ON FUNCTION ${sql.raw(FUNCTION)} TO ${sql.raw(appRole())}`.execute(db)
}

/**
 * Drops the purge function and the table (its policies and index go with it).
 * Nothing else depends on the table, so this loses only pending Undos.
 *
 * @param db - Migration connection (database owner).
 */
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP FUNCTION IF EXISTS ${sql.raw(FUNCTION)}`.execute(db)
  await sql`DROP TABLE IF EXISTS ${sql.raw(TABLE)}`.execute(db)
}
