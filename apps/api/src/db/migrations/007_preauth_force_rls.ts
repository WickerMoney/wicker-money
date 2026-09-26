import { sql, type Kysely } from 'kysely'
import { ensureRowSecurity } from './support/index.js'

/**
 * @module
 * Lifts FORCE ROW LEVEL SECURITY from `core.users` and `core.sessions`, the two
 * tables the pre-authentication functions must touch.
 *
 * Row-level security is FORCEd on the tenant tables. ENABLE subjects ordinary
 * roles to the policies. FORCE additionally subjects the *table owner*,
 * removing the one exemption PostgreSQL grants.
 *
 * The pre-authentication functions rely on exactly that exemption. A SECURITY DEFINER
 * function executes with the privileges of its owner — here, the role that ran
 * the migrations, which is also the table owner. With FORCE in place that
 * inherited ownership buys nothing, so `core.register_user` inserts a row that
 * no policy can accept:
 *
 *     new row violates row-level security policy for table "users"   (42501)
 *
 * and `core.find_user_for_login` silently returns zero rows, which surfaces as
 * "Email or password is incorrect." for a correct password. The three
 * functions are the designed pre-authentication boundary, and FORCE makes that
 * boundary unusable. The two are mutually exclusive on these tables; being
 * able to register and log in is not optional, so FORCE is what gives way.
 *
 * **This is invisible whenever the migration role happens to be a
 * superuser**, because a superuser bypasses RLS unconditionally — FORCE
 * included. The same trap that applies to the application role applies one
 * level up, to the role that owns the functions.
 *
 * What is given up: an accidental query run *as the owner* against
 * `core.users` or `core.sessions` now sees every row. That role exists only to
 * run migrations and never serves a request.
 *
 * What is kept: the application role owns nothing, so ENABLE still applies to
 * it in full, and the six ledger tables keep FORCE — no SECURITY DEFINER
 * function touches those, so nothing there needs the exemption.
 *
 * The invariant this now rests on — the API's role must not own these tables
 * and must not be a superuser — is verified at API startup.
 */

/** Tables whose FORCE ROW LEVEL SECURITY flag is removed. */
const PREAUTH_TABLES = ['users', 'sessions'] as const

/**
 * Ensures `core.users` and `core.sessions` are not FORCEd.
 *
 * Safe to re-run: a table that is already unforced is not touched, because
 * changing the flag takes an exclusive lock on it.
 *
 * @param db - Migration connection (database owner).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  for (const table of PREAUTH_TABLES) {
    await ensureRowSecurity(db, `core.${table}`, false)
  }
}

/**
 * Restores FORCE ROW LEVEL SECURITY on both tables.
 *
 * @param db - Migration connection (database owner).
 */
export async function down(db: Kysely<unknown>): Promise<void> {
  // Restores the original forced state. Registration and login will stop working again
  // unless the migration role is a superuser, which is the whole point above.
  for (const table of PREAUTH_TABLES) {
    await sql`ALTER TABLE ${sql.raw(`core.${table}`)} FORCE ROW LEVEL SECURITY`.execute(db)
  }
}
