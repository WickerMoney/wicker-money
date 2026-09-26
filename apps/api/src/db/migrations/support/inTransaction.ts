import type { Executor } from './Executor.js'

/**
 * Runs `work` inside a transaction, opening one only when the caller has not.
 *
 * Migrations that run outside the migrator's own transaction use this to keep
 * the few steps that must be atomic together (add a column and backfill it)
 * short, instead of holding their locks for the whole migration.
 *
 * @param db - Migration connection or an already-open transaction.
 * @param work - Callback receiving the transaction to use.
 * @returns Whatever `work` returns.
 */
export async function inTransaction<T>(
  db: Executor,
  work: (trx: Executor) => Promise<T>,
): Promise<T> {
  if (db.isTransaction) return work(db)
  return db.transaction().execute(work)
}
