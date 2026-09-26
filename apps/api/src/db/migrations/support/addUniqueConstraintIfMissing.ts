import { sql } from 'kysely'
import { constraintState } from './constraintState.js'
import { createIndexIfMissing } from './createIndexIfMissing.js'
import type { Executor } from './Executor.js'

/**
 * Adds a UNIQUE constraint without holding an exclusive lock while it builds.
 *
 * The unique index is built first (which allows reads), then attached to the
 * table as the constraint, which is a catalog change only. Adding the
 * constraint directly would build the index under an exclusive lock.
 *
 * Every argument is spliced into the statement as SQL, so pass constants only.
 *
 * @param db - Migration connection.
 * @param table - Schema-qualified table name.
 * @param name - Constraint name; the backing index takes the same name.
 * @param columns - Comma-separated column list.
 */
export async function addUniqueConstraintIfMissing(
  db: Executor,
  table: string,
  name: string,
  columns: string,
): Promise<void> {
  if ((await constraintState(db, table, name)) !== 'missing') return
  const schema = table.slice(0, table.indexOf('.'))
  await createIndexIfMissing(db, `${schema}.${name}`, `ON ${table} (${columns})`, { unique: true })
  await sql`
    ALTER TABLE ${sql.raw(table)} ADD CONSTRAINT ${sql.raw(name)} UNIQUE USING INDEX ${sql.raw(name)}
  `.execute(db)
}
