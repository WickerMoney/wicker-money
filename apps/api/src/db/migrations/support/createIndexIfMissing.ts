import { sql } from 'kysely'
import type { CreateIndexOptions } from './CreateIndexOptions.js'
import type { Executor } from './Executor.js'

/**
 * Creates an index unless one with that name exists.
 *
 * Checks the catalog first because `CREATE INDEX IF NOT EXISTS` takes a SHARE
 * lock on the table (blocking writes) before it notices the index is there.
 *
 * Every argument is spliced into the statement as SQL, so pass constants only.
 *
 * @param db - Migration connection.
 * @param qualifiedName - Schema-qualified index name; an index lives in its table's schema.
 * @param definition - Everything after the index name, e.g. `ON core.users (lower(email))`.
 * @param options - See {@link CreateIndexOptions}.
 */
export async function createIndexIfMissing(
  db: Executor,
  qualifiedName: string,
  definition: string,
  options: CreateIndexOptions = {},
): Promise<void> {
  const { rows } = await sql<{ found: boolean }>`
    SELECT to_regclass(${qualifiedName}) IS NOT NULL AS found
  `.execute(db)
  if (rows[0]?.found === true) return
  const name = qualifiedName.slice(qualifiedName.indexOf('.') + 1)
  const unique = options.unique === true ? sql`UNIQUE` : sql``
  await sql`CREATE ${unique} INDEX IF NOT EXISTS ${sql.raw(name)} ${sql.raw(definition)}`.execute(db)
}
