import { sql, type Kysely } from 'kysely'
import { appRole } from './005_app_role.js'
import { FIRST_OWNER_LOCK_KEY } from './026_first_user_owner.js'

/**
 * @module
 * A configured owner email: `BOOTSTRAP_OWNER_EMAIL` decides who becomes the
 * owner, instead of whoever registers first.
 *
 * Migration 026 made the first registration the owner. On an instance that is
 * reachable before its operator has signed up, that is whoever gets there
 * first. The operator can now name the owner's email in configuration; the
 * database cannot read the process environment, so the API passes it in for
 * the registering transaction as the setting `app.bootstrap_owner_email`
 * (`set_config(..., true)`, which ends with the transaction). That is how the
 * API already hands `app.user_id` to the database, and it leaves
 * `core.register_user(text, text)` with the signature, grants and callers it
 * has.
 *
 * **Rules in `core.register_user`.** A new account is an `owner` only when no
 * owner exists yet and the setting allows it:
 *
 *  - setting absent or blank: any registrant may be that owner (the
 *    migration 026 rule, unchanged);
 *  - setting present: only the registrant whose email equals it (compared
 *    after `lower(btrim(...))` on both sides) may be that owner. Everyone else
 *    is a `member` even when no owner exists, so a stranger who registers
 *    first cannot claim the instance. The bootstrap email still becomes the
 *    owner if it registers after other members.
 *
 * "No owner exists yet" is decided under the same advisory lock as before,
 * so racing registrations still produce one owner. Registrations that cannot
 * become the owner never take the lock.
 *
 * **What it does not do.** It never creates a second owner while one exists
 * (the bootstrap email registering later becomes a member then), and it never
 * changes an existing account's role. Registration does not verify email
 * addresses, so anyone who knows the configured address and registers it
 * first becomes the owner. The setting stops strangers claiming a fresh
 * instance by accident; it is not authentication.
 *
 * **`core.instance_has_users()`** lets the API's start-up check ask whether
 * any account exists. The application role cannot count `core.users` itself
 * (row-level security shows it nothing before sign-in), so like the other
 * pre-authentication functions this one is `SECURITY DEFINER` and returns
 * only a boolean.
 *
 * Both functions are replaced in place, so re-running changes nothing, and
 * `register_user` keeps its grants. An older API build calling it without the
 * setting gets the 026 behaviour, so rolling the image back is safe.
 */

/** Name of the transaction-local setting the API sets before registering. */
const SETTING = 'app.bootstrap_owner_email'

/**
 * Replaces `core.register_user` with the version that honours the
 * bootstrap email, and creates `core.instance_has_users`.
 *
 * @param db - Migration connection (database owner).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE OR REPLACE FUNCTION core.register_user(p_email text, p_password_hash text)
    RETURNS TABLE (id uuid, email varchar, timezone text)
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = core, pg_temp
    AS $$
    DECLARE
      v_role core.user_role := 'member';
      v_email text := lower(btrim(p_email));
      -- NULL when the setting does not exist at all, '' once it has been set
      -- and reset in this session; both mean "no bootstrap email".
      v_bootstrap text := lower(btrim(coalesce(current_setting(${sql.lit(SETTING)}, true), '')));
    BEGIN
      -- Only a registrant who may be the owner needs the owner check.
      IF (v_bootstrap = '' OR v_email = v_bootstrap)
         AND NOT EXISTS (SELECT 1 FROM core.users u WHERE u.role = 'owner') THEN
        PERFORM pg_advisory_xact_lock(${sql.lit(FIRST_OWNER_LOCK_KEY)}::bigint);
        IF NOT EXISTS (SELECT 1 FROM core.users u WHERE u.role = 'owner') THEN
          v_role := 'owner';
        END IF;
      END IF;

      RETURN QUERY
      INSERT INTO core.users (email, password_hash, role)
      VALUES (v_email, p_password_hash, v_role)
      RETURNING core.users.id, core.users.email, core.users.timezone;
    END
    $$
  `.execute(db)

  await sql`
    CREATE OR REPLACE FUNCTION core.instance_has_users()
    RETURNS boolean
    LANGUAGE sql SECURITY DEFINER STABLE SET search_path = core, pg_temp
    AS $$
      SELECT EXISTS (SELECT 1 FROM core.users)
    $$
  `.execute(db)
  await sql`REVOKE ALL ON FUNCTION core.instance_has_users() FROM PUBLIC`.execute(db)
  await sql`GRANT EXECUTE ON FUNCTION core.instance_has_users() TO ${sql.raw(appRole())}`.execute(db)
}

/**
 * Restores the registration function from migration 026 (the first account is
 * the owner) and drops `core.instance_has_users`. Roles already assigned are
 * left as they are.
 *
 * @param db - Migration connection (database owner).
 */
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE OR REPLACE FUNCTION core.register_user(p_email text, p_password_hash text)
    RETURNS TABLE (id uuid, email varchar, timezone text)
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = core, pg_temp
    AS $$
    DECLARE
      v_role core.user_role := 'member';
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM core.users u WHERE u.role = 'owner') THEN
        PERFORM pg_advisory_xact_lock(${sql.lit(FIRST_OWNER_LOCK_KEY)}::bigint);
        IF NOT EXISTS (SELECT 1 FROM core.users u WHERE u.role = 'owner') THEN
          v_role := 'owner';
        END IF;
      END IF;

      RETURN QUERY
      INSERT INTO core.users (email, password_hash, role)
      VALUES (lower(btrim(p_email)), p_password_hash, v_role)
      RETURNING core.users.id, core.users.email, core.users.timezone;
    END
    $$
  `.execute(db)

  await sql`DROP FUNCTION IF EXISTS core.instance_has_users()`.execute(db)
}
