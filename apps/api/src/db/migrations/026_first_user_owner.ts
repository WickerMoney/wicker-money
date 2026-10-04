import { sql, type Kysely } from 'kysely'

/**
 * @module
 * Only the first account on an instance becomes its owner.
 *
 * `core.users.role` defaulted to `owner` and `core.register_user` never set
 * it, so every account anyone registered could administer the instance
 * (switch plugins on and off for everyone, for example). From here:
 *
 *  - the column defaults to `member`, so any insert that does not choose a
 *    role gets the safe one;
 *  - `core.register_user` makes the new account an `owner` only when no owner
 *    exists yet, and a `member` otherwise.
 *
 * **Race safety.** Two first registrations arriving together could each see
 * "no owner yet". When the cheap check finds no owner, the function takes a
 * transaction-scoped advisory lock and checks again under it. The lock is
 * held until the registering transaction commits, so the second registration
 * waits, then sees the first one's owner row and becomes a member. Once an
 * owner exists the lock is never taken, so ordinary sign-ups do not queue
 * behind each other.
 *
 * **Existing accounts are not touched.** An instance upgraded with several
 * accounts keeps every one of them as an owner; demoting anyone is the
 * operator's decision (see the release notes for the SQL). An instance whose
 * owners have all been demoted gets a new owner from its next registration,
 * which is the same rule: nobody owns it, so the next account does.
 *
 * The function keeps its signature, so its grants and callers are unchanged.
 */

/**
 * Advisory lock key that serializes "is there an owner yet?" decisions. An
 * arbitrary constant; it only has to be unique among this database's
 * advisory locks, and nothing else in the schema takes one.
 */
export const FIRST_OWNER_LOCK_KEY = 7_302_026_001

/**
 * Sets `core.users.role`'s default, unless it already is that.
 *
 * `ALTER COLUMN ... SET DEFAULT` takes an ACCESS EXCLUSIVE lock on the table
 * even when nothing changes, and every migration must be re-runnable without
 * blocking requests, so the current default is checked first.
 *
 * @param db - Migration connection (database owner).
 * @param role - The role new rows should get by default.
 */
async function setRoleDefault(db: Kysely<unknown>, role: 'owner' | 'member'): Promise<void> {
  const { rows } = await sql<{ current: string | null }>`
    SELECT pg_get_expr(d.adbin, d.adrelid) AS current
    FROM pg_attribute a
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attrelid = 'core.users'::regclass AND a.attname = 'role'
  `.execute(db)
  if (rows[0]?.current === `'${role}'::core.user_role`) return
  await sql`ALTER TABLE core.users ALTER COLUMN role SET DEFAULT ${sql.lit(role)}`.execute(db)
}

/**
 * Defaults new accounts to `member` and makes registration grant `owner`
 * only to the first account.
 *
 * Safe to re-run: the default is only altered when it differs, and the
 * function is replaced in place, keeping its grants.
 *
 * @param db - Migration connection (database owner).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await setRoleDefault(db, 'member')

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
}

/**
 * Restores the `owner` default and the registration function from migration
 * 006, under which every new account is an owner. Roles already assigned are
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
    BEGIN
      RETURN QUERY
      INSERT INTO core.users (email, password_hash)
      VALUES (lower(btrim(p_email)), p_password_hash)
      RETURNING core.users.id, core.users.email, core.users.timezone;
    END
    $$
  `.execute(db)

  await setRoleDefault(db, 'owner')
}
