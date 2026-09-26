import { sql } from 'kysely'
import { constraintState } from './constraintState.js'
import type { Executor } from './Executor.js'

/**
 * Adds a CHECK or FOREIGN KEY constraint and validates it, doing only the part
 * that is still outstanding.
 *
 * The constraint is added `NOT VALID` first and validated afterwards. Adding it
 * this way only takes a brief lock and does not scan; `VALIDATE CONSTRAINT`
 * then scans under `SHARE UPDATE EXCLUSIVE`, which lets reads and writes
 * continue. That separation only helps when the two statements commit
 * separately, so migrations that use this run outside the migrator's
 * transaction. Re-running against a validated constraint issues no statement.
 *
 * Every argument is spliced into the statement as SQL, so pass constants only.
 *
 * @param db - Migration connection.
 * @param table - Schema-qualified table name.
 * @param name - Constraint name.
 * @param definition - Everything after the name, e.g. `CHECK (amount > 0)`.
 */
export async function addConstraintIfMissing(
  db: Executor,
  table: string,
  name: string,
  definition: string,
): Promise<void> {
  const state = await constraintState(db, table, name)
  if (state === 'valid') return
  if (state === 'missing') {
    await sql`
      ALTER TABLE ${sql.raw(table)}
        ADD CONSTRAINT ${sql.raw(name)} ${sql.raw(definition)} NOT VALID
    `.execute(db)
  }
  await sql`ALTER TABLE ${sql.raw(table)} VALIDATE CONSTRAINT ${sql.raw(name)}`.execute(db)
}
