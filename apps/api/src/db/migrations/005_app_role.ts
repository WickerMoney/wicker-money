import { sql, type Kysely } from 'kysely'

/**
 * @module
 * The least-privilege role the API connects as.
 *
 * This migration is load-bearing for the whole isolation model. A SUPERUSER
 * bypasses row-level security unconditionally — FORCE ROW LEVEL SECURITY does
 * not apply to them — so if the API connected as a superuser, every RLS policy
 * would be decorative and any test of them would be a false pass.
 *
 * The role (`wickermoney_app` by default) owns nothing, creates nothing, and holds
 * only DML on the core tables. It is created NOLOGIN with no password; enabling
 * login is a deployment step. Per-plugin roles follow the same principle, with
 * grants narrowed to each plugin's declared tables.
 */

/** Role name used when `APP_DB_ROLE` is unset. */
const DEFAULT_APP_ROLE = 'wickermoney_app'

/**
 * Name of the application role.
 *
 * Configurable because PostgreSQL roles are CLUSTER-wide, not per-database. Two
 * databases on one server — a dev database and a test database, say — would
 * otherwise share a single role, and whichever ran last would own its password.
 * That is silent and confusing: the test suite would reset the credential the
 * dev environment depends on.
 *
 * @returns `APP_DB_ROLE` if set, else `wickermoney_app`.
 * @throws {Error} If the configured name is not a lowercase identifier.
 */
export function appRole(): string {
  const name = process.env['APP_DB_ROLE'] ?? DEFAULT_APP_ROLE
  // The value reaches SQL through sql.raw (identifiers cannot be parameterised),
  // so it is validated rather than trusted.
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(name)) {
    throw new Error(
      `APP_DB_ROLE must be a lowercase identifier ([a-z_][a-z0-9_]*), got: ${name}`,
    )
  }
  return name
}

/** @deprecated Prefer appRole(); kept so existing imports keep compiling. */
export const APP_ROLE = DEFAULT_APP_ROLE

/**
 * Creates the application role (if absent) and grants it DML on `core`.
 *
 * Idempotent, since roles outlive databases. Also sets default privileges so
 * tables created by later migrations are granted automatically, and grants
 * EXECUTE on `core.current_user_id()` (needed by every policy).
 *
 * @param db - Migration connection (database owner).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  const name = appRole()
  const role = sql.raw(name)

  // Roles are cluster-scoped, so this is idempotent rather than a plain CREATE.
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${sql.lit(name)}) THEN
        EXECUTE format('CREATE ROLE %I NOLOGIN', ${sql.lit(name)});
      END IF;
    END
    $$
  `.execute(db)

  await sql`GRANT USAGE ON SCHEMA core TO ${role}`.execute(db)
  await sql`
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON ALL TABLES IN SCHEMA core TO ${role}
  `.execute(db)
  // Tables added by later migrations inherit the same grant automatically.
  await sql`
    ALTER DEFAULT PRIVILEGES IN SCHEMA core
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role}
  `.execute(db)
  await sql`GRANT EXECUTE ON FUNCTION core.current_user_id() TO ${role}`.execute(db)

  // Deliberately NOT granted: CREATE on the schema, ownership of any table, or
  // BYPASSRLS. Without those the RLS policies are unavoidable.
}

/**
 * Revokes the application role's privileges on `core`. The role itself is left
 * in place because roles are cluster-wide and may serve other databases.
 *
 * @param db - Migration connection (database owner).
 */
export async function down(db: Kysely<unknown>): Promise<void> {
  const role = sql.raw(appRole())
  await sql`ALTER DEFAULT PRIVILEGES IN SCHEMA core REVOKE ALL ON TABLES FROM ${role}`.execute(db)
  await sql`REVOKE ALL ON ALL TABLES IN SCHEMA core FROM ${role}`.execute(db)
  await sql`REVOKE USAGE ON SCHEMA core FROM ${role}`.execute(db)
}
