import { sql } from 'kysely'
import type { ConstraintValidity } from './ConstraintValidity.js'
import type { Executor } from './Executor.js'

/**
 * Looks up a table constraint by name.
 *
 * @param db - Migration connection.
 * @param table - Schema-qualified table name.
 * @param name - Constraint name.
 * @returns Its {@link ConstraintValidity}.
 */
export async function constraintState(
  db: Executor,
  table: string,
  name: string,
): Promise<ConstraintValidity> {
  const { rows } = await sql<{ convalidated: boolean }>`
    SELECT convalidated FROM pg_constraint
    WHERE conrelid = to_regclass(${table}) AND conname = ${name}
  `.execute(db)
  const row = rows[0]
  if (row === undefined) return 'missing'
  return row.convalidated ? 'valid' : 'not_validated'
}
