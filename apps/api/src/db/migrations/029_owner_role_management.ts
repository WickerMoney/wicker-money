import { sql, type Kysely } from 'kysely'
import { appRole } from './005_app_role.js'
import { FIRST_OWNER_LOCK_KEY } from './026_first_user_owner.js'

/**
 * @module
 * Owners can see every account and change another account's role.
 *
 * Until now the only way to promote or demote anyone was SQL run by the
 * operator. The Settings page needs two things the application role cannot do
 * on its own: `core.users` has row-level security keyed on the row's own id,
 * so an owner sees exactly one row (their own) and cannot update anyone
 * else's. Loosening that policy for owners would also expose password
 * digests to every query an owner's session runs, so, like registration and
 * login, the two operations are narrow `SECURITY DEFINER` functions instead.
 * They run with the privileges of the role that owns the table (which does
 * not have row-level security forced on `core.users`; see migration 007), and
 * they return only the columns the screen needs: id, email, role and
 * creation time.
 *
 * **The functions do their own authorization.** Both read the caller from
 * `core.current_user_id()`, which only returns an id when the transaction
 * carries a valid signature for it (migration 018), and refuse unless that
 * account is an owner right now (`42501`, `insufficient_privilege`). The API
 * checks the role first, via `requireOwner`, and the database checks it
 * again, so a mistake in a route cannot turn these functions into a way for a
 * member to promote themselves.
 *
 * **Rules in `core.set_user_role`.**
 *
 *  - The target must exist (`P0002`, `no_data_found`).
 *  - Setting a role an account already has changes nothing and succeeds, so
 *    a repeated request is harmless. `previous_role` in the result tells the
 *    caller whether anything happened.
 *  - Demoting the only owner is refused (`WM001`, a code private to this
 *    schema). That covers an owner demoting themselves while they are the
 *    last owner. An owner may demote themselves when another owner exists.
 *  - Promoting an account to `owner` is allowed whenever the caller is an
 *    owner. This is how an instance gets a second owner. It does not conflict
 *    with migrations 026 and 028: they promise that registration never makes
 *    a second owner by itself, and that is still true. Registration is a
 *    different function, and it is not changed here.
 *
 * **Concurrency.** The last-owner rule is a count, and two owners demoting
 * each other at the same moment could each see two owners and each remove
 * one, leaving none. The function therefore takes the advisory lock that
 * registration already uses for "is there an owner yet?"
 * ({@link FIRST_OWNER_LOCK_KEY}) and checks the caller's role again once it
 * holds it. The second of two competing demotions waits, then finds either
 * that its caller is no longer an owner (`42501`) or that the target is now
 * the last one (`WM001`). The same lock keeps a registration that is deciding
 * whether the instance has an owner from racing a demotion.
 *
 * The count is only correct if the statements after the lock see what the
 * other transaction committed. That is true at `READ COMMITTED`, the default,
 * and not at `REPEATABLE READ`, where the snapshot predates the lock. The
 * function refuses to run at any other isolation level (`25000`) instead of
 * quietly miscounting.
 *
 * **Sessions.** A role change does not end the affected account's sessions.
 * The role is read from the database on every request (`requireOwner`), so a
 * demoted owner is refused on their very next owner-only request while their
 * signed-in tab still shows owner controls until it next reads `/auth/me`.
 *
 * Both functions are replaced in place, so re-running changes nothing, and
 * only the application role may execute them.
 */

/** SQLSTATE the functions raise when the caller is not an owner (`insufficient_privilege`). */
export const OWNER_REQUIRED_SQLSTATE = '42501'

/** SQLSTATE the functions raise when the target account does not exist (`no_data_found`). */
export const NO_SUCH_USER_SQLSTATE = 'P0002'

/** SQLSTATE raised when a change would leave the instance with no owner. Private to this schema. */
export const LAST_OWNER_SQLSTATE = 'WM001'

/** SQLSTATE raised when the transaction is not at `READ COMMITTED` (`invalid_transaction_state`). */
export const WRONG_ISOLATION_SQLSTATE = '25000'

/**
 * Creates `core.list_users_for_owner` and `core.set_user_role` and grants
 * them to the application role only.
 *
 * @param db - Migration connection (database owner).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  const role = sql.raw(appRole())

  await sql`
    CREATE OR REPLACE FUNCTION core.list_users_for_owner()
    RETURNS TABLE (id uuid, email varchar, role core.user_role, created_at timestamptz)
    LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = core, pg_temp
    AS $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM core.users c WHERE c.id = core.current_user_id() AND c.role = 'owner'
      ) THEN
        RAISE EXCEPTION 'Only an owner can list accounts.' USING ERRCODE = ${sql.lit(OWNER_REQUIRED_SQLSTATE)};
      END IF;

      RETURN QUERY
      SELECT u.id, u.email, u.role, u.created_at
      FROM core.users u
      ORDER BY u.created_at, u.id;
    END
    $$
  `.execute(db)

  await sql`
    CREATE OR REPLACE FUNCTION core.set_user_role(p_user_id uuid, p_role core.user_role)
    RETURNS TABLE (id uuid, email varchar, role core.user_role, created_at timestamptz, previous_role core.user_role)
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = core, pg_temp
    AS $$
    DECLARE
      v_previous core.user_role;
    BEGIN
      IF current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION 'Role changes must run at READ COMMITTED.' USING ERRCODE = ${sql.lit(WRONG_ISOLATION_SQLSTATE)};
      END IF;

      -- Refuse non-owners before they can queue on the lock.
      IF NOT EXISTS (
        SELECT 1 FROM core.users c WHERE c.id = core.current_user_id() AND c.role = 'owner'
      ) THEN
        RAISE EXCEPTION 'Only an owner can change roles.' USING ERRCODE = ${sql.lit(OWNER_REQUIRED_SQLSTATE)};
      END IF;

      -- One role change (or first registration) decides at a time, and it
      -- decides on what the previous one committed.
      PERFORM pg_advisory_xact_lock(${sql.lit(FIRST_OWNER_LOCK_KEY)}::bigint);

      -- The caller may have been demoted while this call waited.
      IF NOT EXISTS (
        SELECT 1 FROM core.users c WHERE c.id = core.current_user_id() AND c.role = 'owner'
      ) THEN
        RAISE EXCEPTION 'Only an owner can change roles.' USING ERRCODE = ${sql.lit(OWNER_REQUIRED_SQLSTATE)};
      END IF;

      SELECT t.role INTO v_previous FROM core.users t WHERE t.id = p_user_id FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'No such account.' USING ERRCODE = ${sql.lit(NO_SUCH_USER_SQLSTATE)};
      END IF;

      IF v_previous = 'owner' AND p_role = 'member'
         AND (SELECT count(*) FROM core.users o WHERE o.role = 'owner') <= 1 THEN
        RAISE EXCEPTION 'An instance must keep at least one owner.' USING ERRCODE = ${sql.lit(LAST_OWNER_SQLSTATE)};
      END IF;

      IF v_previous <> p_role THEN
        UPDATE core.users SET role = p_role, updated_at = now() WHERE core.users.id = p_user_id;
      END IF;

      RETURN QUERY
      SELECT u.id, u.email, u.role, u.created_at, v_previous
      FROM core.users u
      WHERE u.id = p_user_id;
    END
    $$
  `.execute(db)

  // SECURITY DEFINER functions are executable by PUBLIC by default.
  for (const fn of ['core.list_users_for_owner()', 'core.set_user_role(uuid, core.user_role)']) {
    await sql`REVOKE ALL ON FUNCTION ${sql.raw(fn)} FROM PUBLIC`.execute(db)
    await sql`GRANT EXECUTE ON FUNCTION ${sql.raw(fn)} TO ${role}`.execute(db)
  }
}

/**
 * Drops both functions. Roles already assigned are left as they are.
 *
 * @param db - Migration connection (database owner).
 */
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP FUNCTION IF EXISTS core.set_user_role(uuid, core.user_role)`.execute(db)
  await sql`DROP FUNCTION IF EXISTS core.list_users_for_owner()`.execute(db)
}
