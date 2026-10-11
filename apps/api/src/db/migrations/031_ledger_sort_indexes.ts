import { sql, type Kysely } from 'kysely'
import { createIndexIfMissing } from './support/index.js'

/**
 * Adds the indexes that match the keyset order of the transaction list for the
 * merchant and amount sorts.
 *
 * The list pages by `(sort column, id)`, both in the same direction. An index
 * that stops at the sort column makes the planner read every row tied on that
 * column and sort them again (an incremental sort), and for `merchant` there
 * was no index at all, so every page sorted the user's whole ledger. Each
 * index below ends in `id`, so it hands the rows over in exactly the order the
 * list asks for. One index serves both directions: the opposite direction is a
 * backward scan.
 *
 *  - `(user_id, merchant, id)` removes the full per-user sort on every
 *    merchant page. It also gives deep merchant pages an index bound, because
 *    text comparison is leakproof and so can be pushed into an index scan
 *    under row-level security.
 *  - `(user_id, amount, id)` serves the first page of an amount sort without
 *    reading the whole run of rows that tie on the amount it starts in. It
 *    does not speed up deep amount pages: numeric comparison is not leakproof,
 *    so PostgreSQL will not use the keyset predicate as an index bound while
 *    the row-level security policy is in force.
 *
 * The date sort already ran in a fraction of a millisecond on
 * `ix_transactions_user_date` (an incremental sort over at most one day of
 * rows), so it gets no new index: `(user_id, transaction_date DESC, id DESC)`
 * measured no better than that on a table stored in date order, and only a few
 * milliseconds better on one that is not.
 *
 * `ix_transactions_user_amount` (migration 015) is now a prefix of the amount
 * index but is left in place: nothing here proves no other query still prefers
 * it.
 *
 * Each index is built with a plain `CREATE INDEX`, which blocks writes to
 * `core.transactions` while it builds. The migration runs without a wrapping
 * transaction, so that lasts one index at a time rather than for the whole
 * migration. That is accepted for self-hosting; a much larger ledger should
 * build them `CONCURRENTLY`. Safe to re-run: an index that exists is skipped
 * without touching the table.
 *
 * @param db - Migration connection (database owner).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await createIndexIfMissing(
    db,
    'core.ix_transactions_user_merchant_id',
    'ON core.transactions (user_id, merchant, id)',
  )
  await createIndexIfMissing(
    db,
    'core.ix_transactions_user_amount_id',
    'ON core.transactions (user_id, amount, id)',
  )
}

/**
 * Tells the migrator to run this migration without wrapping it in a
 * transaction, so each index build holds its lock alone. Every step is
 * idempotent.
 */
export const transactional = false

/**
 * Drops the indexes added by {@link up}.
 *
 * @param db - Migration connection (database owner).
 */
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS core.ix_transactions_user_amount_id`.execute(db)
  await sql`DROP INDEX IF EXISTS core.ix_transactions_user_merchant_id`.execute(db)
}
