import { sql, type Kysely } from 'kysely'
import { appRole } from './005_app_role.js'

/**
 * Creates the three SECURITY DEFINER functions that run BEFORE a user context
 * exists: `core.register_user`, `core.find_user_for_login` and
 * `core.find_session_for_refresh`, executable only by the application role.
 *
 * Registration, login lookup and refresh-token lookup all run with no
 * `app.user_id` set, so every RLS policy correctly denies them. Rather than
 * weakening those policies — which would expose every row to every
 * unauthenticated request — each operation gets a narrow SECURITY DEFINER
 * function.
 *
 * This is a better boundary than a general escape hatch: the complete set of
 * things possible before authentication is three functions, each doing exactly
 * one thing. Nothing else can read `core.users` without a user context.
 *
 * Each function pins `search_path`. Without it, a caller able to set their own
 * search_path could shadow a referenced object and have it execute with the
 * definer's privileges.
 *
 * Safe to re-run: the functions are replaced in place (keeping their grants)
 * and the grants are re-applied.
 *
 * @param db - Migration connection (database owner).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  const role = sql.raw(appRole())

  await sql`
    CREATE OR REPLACE FUNCTION core.register_user(p_email text, p_password_hash text)
    RETURNS TABLE (id uuid, email varchar, timezone text)
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = core, pg_temp
    AS $$
    BEGIN
      RETURN QUERY
      INSERT INTO core.users (email, password_hash)
      VALUES (lower(btrim(p_email)), p_password_hash)
      RETURNING core.users.id, core.users.email, core.users.timezone;
    END
    $$
  `.execute(db)

  await sql`
    CREATE OR REPLACE FUNCTION core.find_user_for_login(p_email text)
    RETURNS TABLE (id uuid, email varchar, timezone text, password_hash text)
    LANGUAGE sql SECURITY DEFINER STABLE SET search_path = core, pg_temp
    AS $$
      SELECT u.id, u.email, u.timezone, u.password_hash
      FROM core.users u
      WHERE lower(u.email) = lower(btrim(p_email))
    $$
  `.execute(db)

  await sql`
    CREATE OR REPLACE FUNCTION core.find_session_for_refresh(p_token_hash text)
    RETURNS TABLE (session_id uuid, user_id uuid, email varchar, timezone text)
    LANGUAGE sql SECURITY DEFINER STABLE SET search_path = core, pg_temp
    AS $$
      SELECT s.id, s.user_id, u.email, u.timezone
      FROM core.sessions s
      JOIN core.users u ON u.id = s.user_id
      WHERE s.token_hash = p_token_hash
        AND s.revoked_at IS NULL
        AND s.expires_at > now()
    $$
  `.execute(db)

  // SECURITY DEFINER functions are executable by PUBLIC by default. Revoke
  // first, then grant only to the application role.
  for (const fn of [
    'core.register_user(text, text)',
    'core.find_user_for_login(text)',
    'core.find_session_for_refresh(text)',
  ]) {
    await sql`REVOKE ALL ON FUNCTION ${sql.raw(fn)} FROM PUBLIC`.execute(db)
    await sql`GRANT EXECUTE ON FUNCTION ${sql.raw(fn)} TO ${role}`.execute(db)
  }
}

/**
 * Drops the three pre-authentication functions.
 *
 * @param db - Migration connection (database owner).
 */
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP FUNCTION IF EXISTS core.find_session_for_refresh(text)`.execute(db)
  await sql`DROP FUNCTION IF EXISTS core.find_user_for_login(text)`.execute(db)
  await sql`DROP FUNCTION IF EXISTS core.register_user(text, text)`.execute(db)
}
