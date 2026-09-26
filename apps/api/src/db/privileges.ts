import { sql } from 'kysely'
import type { Db } from './client.js'

/** How the connected database role stands relative to row-level security. */
export interface RolePrivileges {
  /** Name of the current database role. */
  readonly role: string
  /** True if the role is a superuser (bypasses all RLS). */
  readonly isSuperuser: boolean
  /** True if the role has the BYPASSRLS attribute. */
  readonly bypassesRls: boolean
  /** True if the role owns `core.users` (owners are exempt from policies unless FORCE ROW LEVEL SECURITY is set). */
  readonly ownsUsersTable: boolean
}

/**
 * Describes how the connected role stands in relation to row-level security.
 *
 * Each of these three is a way for RLS to be silently inert rather than
 * enforced, and none of them produces an error — queries simply start
 * returning rows they should not. That makes them the one thing worth an
 * explicit assertion rather than a test.
 *
 * @param db - Database handle connected as the role to inspect.
 * @returns The role's RLS-relevant privileges.
 * @throws {Error} If `core.users` cannot be found (migrations not applied).
 */
export async function inspectRolePrivileges(db: Db): Promise<RolePrivileges> {
  const { rows } = await sql<{
    role: string
    is_superuser: boolean
    bypasses_rls: boolean
    owns_users_table: boolean
  }>`
    SELECT current_user::text                                    AS role,
           r.rolsuper                                            AS is_superuser,
           r.rolbypassrls                                        AS bypasses_rls,
           pg_catalog.pg_get_userbyid(c.relowner) = current_user  AS owns_users_table
    FROM pg_catalog.pg_roles r
    CROSS JOIN pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE r.rolname = current_user
      AND n.nspname = 'core'
      AND c.relname = 'users'
  `.execute(db)

  const row = rows[0]
  if (row === undefined) {
    throw new Error('Could not inspect role privileges: core.users was not found.')
  }
  return {
    role: row.role,
    isSuperuser: row.is_superuser,
    bypassesRls: row.bypasses_rls,
    ownsUsersTable: row.owns_users_table,
  }
}

/**
 * Explains why a role would defeat row-level security, or returns null.
 *
 * Separate from the assertion so it can be unit-tested against constructed
 * inputs without needing three differently-privileged database roles.
 *
 * @param p - Privileges as returned by {@link inspectRolePrivileges}.
 * @returns A multi-line human-readable explanation, or `null` if the role is safe.
 */
export function describePrivilegeViolation(p: RolePrivileges): string | null {
  if (p.isSuperuser) {
    return (
      `The API is connected as '${p.role}', which is a SUPERUSER.\n` +
      `A superuser bypasses row-level security unconditionally, so every policy\n` +
      `on the row-level-security tables is inert and users can read each other's data.`
    )
  }
  if (p.bypassesRls) {
    return (
      `The API is connected as '${p.role}', which has the BYPASSRLS attribute.\n` +
      `Row-level security does not apply to it, so every policy is inert.`
    )
  }
  if (p.ownsUsersTable) {
    return (
      `The API is connected as '${p.role}', which OWNS core.users.\n` +
      `A table's owner is exempt from its policies unless FORCE ROW LEVEL\n` +
      `SECURITY is set, and the schema deliberately leaves FORCE off on\n` +
      `core.users and core.sessions so the pre-auth functions can work.\n` +
      `Connecting as the owner therefore disables user isolation entirely.`
    )
  }
  return null
}

/**
 * Fails startup if the connected role could bypass row-level security.
 *
 * Every isolation guarantee this application makes rests on the API connecting
 * as a role that is not a superuser, does not hold BYPASSRLS, and does not own
 * the tables. Get that wrong and nothing breaks — the policies just stop
 * applying, quietly, and a test suite written against that connection passes
 * for the wrong reason.
 *
 * So it is checked at boot, where it is one query and a clear message.
 *
 * @param db - Database handle connected as the application role.
 * @throws {Error} With an explanation and remediation hint if the role is a
 *   superuser, has BYPASSRLS, or owns `core.users`.
 */
export async function assertLeastPrivilege(db: Db): Promise<void> {
  const violation = describePrivilegeViolation(await inspectRolePrivileges(db))
  if (violation === null) return

  throw new Error(
    `${violation}\n\n` +
      `Point DATABASE_URL at the application role (wickermoney_app by default),\n` +
      `not the database owner. DATABASE_OWNER_URL is for migrations only —\n` +
      `the two URLs address the same database as different roles.`,
  )
}
