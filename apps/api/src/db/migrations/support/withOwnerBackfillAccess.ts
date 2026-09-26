import { sql } from 'kysely'
import type { Executor } from './Executor.js'
import { inTransaction } from './inTransaction.js'

/** Name of the transient policy that lets the table owner through row-level security. */
const POLICY = 'migration_backfill'

/**
 * Runs a data backfill that must read and write tenant tables as their owner.
 *
 * Tenant tables have FORCE row-level security, which removes the owner's usual
 * exemption, and a migration has no tenant context, so every policy would
 * match nothing: an UPDATE would touch zero rows and still report success.
 *
 * For the duration of one transaction each table gets a permissive policy that
 * applies to the connected role only (the application role is never affected)
 * and admits every row. The policy is dropped before the transaction ends, and
 * if `work` fails the rollback removes it. FORCE itself is never toggled and
 * nothing depends on a tenant setting.
 *
 * Creating and dropping a policy takes an exclusive lock on the table, held
 * until commit, so the transaction is opened here (unless the caller already
 * has one) and `work` should be a single set-based statement rather than a long
 * loop: that keeps the window in which readers wait as short as the data allows.
 *
 * @param db - Migration connection or an open transaction.
 * @param tables - Schema-qualified tables the backfill touches.
 * @param work - The backfill; receives the transaction to run its statements on.
 * @returns Whatever `work` returns.
 */
export async function withOwnerBackfillAccess<T>(
  db: Executor,
  tables: readonly string[],
  work: (trx: Executor) => Promise<T>,
): Promise<T> {
  return inTransaction(db, async (trx) => {
    for (const table of tables) {
      // A leftover from an interrupted manual run would make CREATE fail.
      await sql`DROP POLICY IF EXISTS ${sql.raw(POLICY)} ON ${sql.raw(table)}`.execute(trx)
      await sql`
        CREATE POLICY ${sql.raw(POLICY)} ON ${sql.raw(table)}
          TO CURRENT_USER USING (true) WITH CHECK (true)
      `.execute(trx)
    }
    const result = await work(trx)
    for (const table of tables) {
      await sql`DROP POLICY ${sql.raw(POLICY)} ON ${sql.raw(table)}`.execute(trx)
    }
    return result
  })
}
