import { sql } from 'kysely'
import { constraintState } from './constraintState.js'
import type { Executor } from './Executor.js'

/**
 * Drops a constraint if it exists.
 *
 * Checks the catalog first because `DROP CONSTRAINT IF EXISTS` takes its
 * exclusive table lock even when there is nothing to drop.
 *
 * @param db - Migration connection.
 * @param table - Schema-qualified table name.
 * @param name - Constraint name.
 */
export async function dropConstraintIfExists(
  db: Executor,
  table: string,
  name: string,
): Promise<void> {
  if ((await constraintState(db, table, name)) === 'missing') return
  await sql`ALTER TABLE ${sql.raw(table)} DROP CONSTRAINT ${sql.raw(name)}`.execute(db)
}
