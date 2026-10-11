import { sql } from 'kysely'
import type { Db } from '../db/client.js'

/**
 * Runs `fn` on an instance whose owners are exactly `owners`, then puts the
 * previous owners back, whatever happens.
 *
 * Integration tests share one database that other suites have filled with
 * owners, and the rules under test ("the last owner cannot be demoted") are
 * about the whole instance. Everyone else is demoted first, so the rule sees
 * the instance the test describes. Suites run one file at a time, so nothing
 * else observes the gap.
 *
 * @param admin - Connection as the database owner, which row-level security does not bind.
 * @param owners - The accounts that should be the only owners while `fn` runs; may be empty.
 * @param fn - The test body.
 */
export async function withOwners(admin: Db, owners: ReadonlyArray<{ readonly id: string }>, fn: () => Promise<void>): Promise<void> {
  const { rows } = await sql<{ id: string }>`
    UPDATE core.users SET role = 'member' WHERE role = 'owner' RETURNING id
  `.execute(admin)
  const previous = rows.map((r) => r.id)
  const ids = owners.map((o) => o.id)
  if (ids.length > 0) await sql`UPDATE core.users SET role = 'owner' WHERE id = ANY(${ids}::uuid[])`.execute(admin)
  try {
    await fn()
  } finally {
    await sql`UPDATE core.users SET role = 'member' WHERE role = 'owner'`.execute(admin)
    if (previous.length > 0) {
      await sql`UPDATE core.users SET role = 'owner' WHERE id = ANY(${previous}::uuid[])`.execute(admin)
    }
  }
}
