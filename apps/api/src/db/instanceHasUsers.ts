import { sql } from 'kysely'
import type { Db } from './client.js'

/**
 * Whether any account exists on this instance.
 *
 * Asks `core.instance_has_users()` (migration 027) because the application
 * role cannot count `core.users` itself: row-level security shows it no rows
 * until a user is signed in.
 *
 * @param db - Application database handle.
 * @returns `true` if at least one account exists.
 * @throws {Error} If the function is missing (migration 027 not applied) or the query fails.
 */
export async function instanceHasUsers(db: Db): Promise<boolean> {
  const { rows } = await sql<{ has: boolean }>`SELECT core.instance_has_users() AS has`.execute(db)
  return rows[0]?.has === true
}
