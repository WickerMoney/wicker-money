import { sql } from 'kysely'
import { columnExists } from './columnExists.js'
import type { Executor } from './Executor.js'

/**
 * Adds a column unless it already exists.
 *
 * Every argument is spliced into the statement as SQL, so pass constants only.
 *
 * @param db - Migration connection.
 * @param table - Schema-qualified table name.
 * @param column - Column name.
 * @param definition - Type and modifiers, e.g. `timestamptz NOT NULL DEFAULT now()`.
 * @returns True when the column was added by this call, false when it was already there.
 */
export async function addColumnIfMissing(
  db: Executor,
  table: string,
  column: string,
  definition: string,
): Promise<boolean> {
  if (await columnExists(db, table, column)) return false
  await sql`ALTER TABLE ${sql.raw(table)} ADD COLUMN ${sql.raw(column)} ${sql.raw(definition)}`.execute(db)
  return true
}
