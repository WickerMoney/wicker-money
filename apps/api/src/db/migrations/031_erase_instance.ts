import { sql, type Kysely } from 'kysely'
import { appRole } from './005_app_role.js'
import { FIRST_OWNER_LOCK_KEY } from './026_first_user_owner.js'

/**
 * @module
 * Erasing a whole instance, and counting who is still signed in first.
 *
 * Every table that holds user data is protected by row-level security that
 * shows a request only its own user's rows, and the application role may not
 * `TRUNCATE`. That is the point of the design, and it is also why "erase this
 * entire instance" cannot be written as queries the API sends: an owner sees
 * one row of `core.users` (their own) and none of anyone else's data. The two
 * operations are therefore narrow `SECURITY DEFINER` functions, like the
 * registration and role-management functions before them (migrations 006, 028
 * and the owner-role screen). They run with the privileges of the role that
 * owns the tables, which is why `TRUNCATE` is available to them.
 *
 * **Both functions do their own authorization.** They read the caller from
 * `core.current_user_id()`, which only returns an id when the transaction
 * carries a valid signature for it (migration 018), and refuse unless that
 * account is an owner right now (`42501`, `insufficient_privilege`). The API
 * checks the role and the owner's password first; the database checks the role
 * again, so a mistake in a route cannot turn these functions into a way for a
 * member to wipe the instance. Only the application role may execute them.
 * A plugin role cannot; a plugin that runs `RESET ROLE` regains the
 * application role's privileges and could call them as its signed-in owner,
 * which is the limit of the plugin trust model already described in
 * `DEVELOPMENT.md` (server code is first-party only).
 *
 * **`core.erase_instance()` empties, it does not drop.** It truncates, in one
 * statement:
 *
 *  - `core.users` (and with it every session);
 *  - every table in `core` that has a `user_id` column;
 *  - every table in every schema whose name starts with `plugin_`, with or
 *    without a `user_id` column.
 *
 * The list is read from the catalog each time rather than written down here,
 * so a table a later migration adds is covered without touching this
 * function. `TRUNCATE` is given no `CASCADE`: a table outside that list which
 * still references one inside it makes the statement fail and roll back,
 * rather than silently emptying more than the list says.
 *
 * Left alone, because they are the instance's configuration and not anyone's
 * data: `core.plugins` (which plugins are enabled, and their settings),
 * `core.app_deployments`, `core.tenant_context_key` (without it the API will
 * not start) and the migration bookkeeping table. Schemas, roles, grants,
 * policies and migrations are not touched, so nothing needs migrating after an
 * erase.
 *
 * It takes the advisory lock registration and role changes use
 * ({@link FIRST_OWNER_LOCK_KEY}), so it cannot interleave with a registration
 * deciding whether the instance has an owner; the first registration to run
 * after it commits finds no accounts, and becomes the owner under the rules of
 * migration 028.
 *
 * **`core.instance_activity(p_exclude_family)`** reports how many session
 * families other than the caller's current one are still live (not revoked, not
 * expired), and how many different accounts they belong to besides the caller.
 * An owner cannot count other accounts' sessions through row-level security,
 * and the confirmation to erase an instance has to say how many people it will
 * sign out.
 *
 * Both functions are replaced in place, so re-running changes nothing.
 */

/** SQLSTATE the functions raise when the caller is not an owner (`insufficient_privilege`). */
export const ERASE_OWNER_REQUIRED_SQLSTATE = '42501'

/** Functions created here, with their argument signatures. */
const FUNCTIONS = ['core.erase_instance()', 'core.instance_activity(uuid)'] as const

/**
 * Creates `core.erase_instance` and `core.instance_activity`, executable only
 * by the application role.
 *
 * @param db - Migration connection (database owner).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE OR REPLACE FUNCTION core.erase_instance()
    RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = core, pg_temp
    AS $$
    DECLARE
      v_caller uuid := core.current_user_id();
      v_tables text;
    BEGIN
      IF v_caller IS NULL OR NOT EXISTS (
        SELECT 1 FROM core.users u WHERE u.id = v_caller AND u.role = 'owner'
      ) THEN
        RAISE EXCEPTION 'Only an owner can erase the instance.' USING ERRCODE = '42501';
      END IF;

      PERFORM pg_advisory_xact_lock(${sql.lit(FIRST_OWNER_LOCK_KEY)}::bigint);

      -- Everything that holds user data, found in the catalog. starts_with and
      -- not LIKE: an underscore in a LIKE pattern is a wildcard.
      SELECT string_agg(format('%I.%I', n.nspname, c.relname), ', ' ORDER BY n.nspname, c.relname)
      INTO v_tables
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p')
        AND (
          starts_with(n.nspname, 'plugin_')
          OR (
            n.nspname = 'core'
            AND c.relname <> 'users'
            AND EXISTS (
              SELECT 1 FROM pg_attribute a
              WHERE a.attrelid = c.oid AND a.attname = 'user_id' AND NOT a.attisdropped
            )
          )
        );

      EXECUTE 'TRUNCATE TABLE core.users' || coalesce(', ' || v_tables, '');
    END
    $$
  `.execute(db)

  await sql`
    CREATE OR REPLACE FUNCTION core.instance_activity(p_exclude_family uuid)
    RETURNS TABLE (other_sessions bigint, other_users bigint)
    LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = core, pg_temp
    AS $$
    DECLARE
      v_caller uuid := core.current_user_id();
    BEGIN
      IF v_caller IS NULL OR NOT EXISTS (
        SELECT 1 FROM core.users u WHERE u.id = v_caller AND u.role = 'owner'
      ) THEN
        RAISE EXCEPTION 'Only an owner can read instance activity.' USING ERRCODE = '42501';
      END IF;

      RETURN QUERY
      SELECT count(DISTINCT s.family_id),
             count(DISTINCT s.user_id) FILTER (WHERE s.user_id <> v_caller)
      FROM core.sessions s
      WHERE s.revoked_at IS NULL
        AND s.expires_at > now()
        AND s.family_id IS DISTINCT FROM p_exclude_family;
    END
    $$
  `.execute(db)

  const role = sql.raw(appRole())
  for (const fn of FUNCTIONS) {
    await sql`REVOKE ALL ON FUNCTION ${sql.raw(fn)} FROM PUBLIC`.execute(db)
    await sql`GRANT EXECUTE ON FUNCTION ${sql.raw(fn)} TO ${role}`.execute(db)
  }
}

/**
 * Drops both functions. Nothing they did is undone: an erased instance stays
 * erased.
 *
 * @param db - Migration connection (database owner).
 */
export async function down(db: Kysely<unknown>): Promise<void> {
  for (const fn of FUNCTIONS) {
    await sql`DROP FUNCTION IF EXISTS ${sql.raw(fn)}`.execute(db)
  }
}
