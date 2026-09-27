import { sql } from 'kysely'
import type { Db } from '../client.js'
import { PERSONAS } from './seedPersonas.js'

/**
 * Deletes every seed persona's user row, by exact email, and returns how many
 * were removed.
 *
 * Everything else this seed creates — accounts, categories, rules,
 * transactions, splits, recurring items, and the plugin-schema rows in
 * `plugin_budgets`/`plugin_import_csv` — carries `user_id uuid ... REFERENCES
 * core.users(id) ON DELETE CASCADE`, so deleting the user is the entire reset.
 * Nothing else needs to be touched, and nothing outside the seed's own three
 * addresses is ever at risk: this matches on exact email, never a domain
 * pattern, so a real account could not be swept up even by a typo here.
 *
 * Run on the OWNER connection deliberately, not the application role bound to
 * a tenant context: `core.users` is `ENABLE`d but not `FORCE`d (migration
 * 004), specifically so the pre-authentication functions can see every row.
 * The table owner gets that same exemption for free, so this needs no tenant
 * context at all — the same reason `pnpm migrate`'s own connection can read
 * and write `core.users` with no user bound.
 *
 * @param ownerDb - A `Db` connected as the database owner (`DATABASE_OWNER_URL`).
 * @returns The number of seed users deleted (0 to {@link PERSONAS}.length).
 */
export async function resetSeedUsers(ownerDb: Db): Promise<number> {
  const emails = PERSONAS.map((p) => p.email.toLowerCase())
  const result = await sql<{ id: string }>`
    DELETE FROM core.users WHERE lower(email) = ANY(${emails}::text[]) RETURNING id
  `.execute(ownerDb)
  return result.rows.length
}
