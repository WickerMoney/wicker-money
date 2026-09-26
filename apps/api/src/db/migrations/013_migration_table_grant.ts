import { sql, type Kysely } from 'kysely'
import { appRole } from './005_app_role.js'

/**
 * Lets the application role read which migrations have actually been applied,
 * by granting SELECT on Kysely's bookkeeping table `public.kysely_migration`.
 *
 * This lets a running instance report which migration its database is on from
 * the database's own record, rather than from whatever the running build has
 * compiled in. The two can disagree: code can ship a migration further than the
 * migrate command has been run against this database, and that gap is worth
 * surfacing.
 *
 * `kysely_migration` lives in the default schema (`public`), not `core`,
 * because migrations run without a `migrationTableSchema` option, so Kysely
 * creates it in the first schema on the connection's search_path — `public`
 * on an otherwise-empty database. It holds nothing but migration names and
 * applied timestamps — no user data — so a narrow, read-only grant costs
 * nothing on the isolation model.
 *
 * @param db - Migration connection (database owner).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  const role = sql.raw(appRole())
  // Explicit rather than relied-upon: PostgreSQL grants USAGE on `public` to
  // PUBLIC by default, but a hardened server may have revoked that, and this
  // migration should not depend on a default it does not control.
  await sql`GRANT USAGE ON SCHEMA public TO ${role}`.execute(db)
  await sql`GRANT SELECT ON public.kysely_migration TO ${role}`.execute(db)
}

/**
 * Revokes the application role's access to `public.kysely_migration` and the
 * `public` schema.
 *
 * @param db - Migration connection (database owner).
 */
export async function down(db: Kysely<unknown>): Promise<void> {
  const role = sql.raw(appRole())
  await sql`REVOKE SELECT ON public.kysely_migration FROM ${role}`.execute(db)
  await sql`REVOKE USAGE ON SCHEMA public FROM ${role}`.execute(db)
}
