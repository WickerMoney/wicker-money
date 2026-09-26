import { sql, type Kysely } from 'kysely'
import { ensurePolicy, ensureRowSecurity } from './support/index.js'

/**
 * @module
 * Row-level security (RLS) for per-user data isolation.
 *
 * Creates `core.current_user_id()` and, for every core table carrying
 * `user_id`, enables RLS (and FORCEs it, except on `users` and `sessions`)
 * with a policy keyed on the `app.user_id` GUC, which the API sets per
 * transaction. `core.users` gets an equivalent policy keyed on its own `id`. The application role is NOT a superuser and
 * does NOT own these tables, so it cannot bypass the policies — that is the
 * whole point. Because the owning column exists on every table, isolation is
 * row-level rather than merely table-level.
 */

/** Tables with a `user_id` column that receive an `<table>_isolation` policy. */
const RLS_TABLES = [
  'accounts',
  'categories',
  'category_rules',
  'transactions',
  'transaction_splits',
  'recurring_items',
  'sessions',
] as const

/**
 * Tables that are enabled but not forced.
 *
 * `core.users` and `core.sessions` are read and written before any user is
 * known, by SECURITY DEFINER functions that run as the table owner. FORCE
 * would remove the owner's exemption from the policies and leave those
 * functions unable to see the rows. The application role owns nothing, so
 * ENABLE alone still binds it in full.
 */
const NOT_FORCED = new Set<string>(['sessions', 'users'])

/**
 * Creates `core.current_user_id()` and applies the isolation policies.
 *
 * Safe to re-run: the function is created only when absent (a later definition
 * of it is never overwritten), and flags and policies already in place are not
 * touched.
 *
 * @param db - Migration connection (database owner).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // Resolves the current request's user. STABLE so the planner may cache it
  // within a statement. Returns NULL when unset, and a NULL never equals a
  // user_id, so an unset GUC yields zero rows rather than every row.
  const { rows } = await sql<{ found: boolean }>`
    SELECT to_regprocedure('core.current_user_id()') IS NOT NULL AS found
  `.execute(db)
  if (rows[0]?.found !== true) {
    await sql`
      CREATE FUNCTION core.current_user_id() RETURNS uuid
      LANGUAGE sql STABLE AS $$
        SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
      $$
    `.execute(db)
  }

  for (const table of RLS_TABLES) {
    const name = `core.${table}`
    // FORCE applies the policy to the table owner too, so a migration-role
    // mistake cannot quietly hand out every row.
    await ensureRowSecurity(db, name, !NOT_FORCED.has(table))
    await ensurePolicy(db, name, `${table}_isolation`, 'user_id = core.current_user_id()')
  }

  // users is scoped by identity rather than ownership.
  await ensureRowSecurity(db, 'core.users', !NOT_FORCED.has('users'))
  await ensurePolicy(db, 'core.users', 'users_isolation', 'id = core.current_user_id()')
}

/**
 * Drops the isolation policies, disables RLS and drops `core.current_user_id()`.
 *
 * @param db - Migration connection (database owner).
 */
export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of [...RLS_TABLES, 'users']) {
    const t = sql.raw(`core.${table}`)
    await sql`DROP POLICY IF EXISTS ${sql.raw(`${table}_isolation`)} ON ${t}`.execute(db)
    await sql`ALTER TABLE ${t} DISABLE ROW LEVEL SECURITY`.execute(db)
  }
  await sql`DROP FUNCTION IF EXISTS core.current_user_id()`.execute(db)
}
