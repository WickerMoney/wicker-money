import { sql, type Kysely } from 'kysely'
import { createIndexIfMissing } from './support/index.js'

/**
 * Adds the indexes the ledger's hot queries need.
 *
 *  - A covering index on `(account_id) INCLUDE (user_id, amount)` lets the per-account
 *    balance `SUM(amount)` run as an index-only scan instead of fetching every
 *    transaction row. It supersedes the plain `account_id` index.
 *  - `(account_id, transaction_date DESC)` serves the import duplicate-window
 *    lookup (one account, a date range).
 *  - A partial index on `transfer_account_id` serves "which transactions point
 *    at this account" checks (usage discovery, history migration), which would
 *    otherwise scan all of the user's rows.
 *  - A partial index on uncategorized, non-transfer rows keeps the triage view
 *    and rule-application scans proportional to the uncategorized backlog
 *    rather than the whole ledger.
 *  - `(user_id, amount)` serves sorting the ledger by amount.
 *  - A trigram index on `merchant` lets `ILIKE '%text%'` search use an index.
 *
 * Each index is built with a plain `CREATE INDEX`, which blocks writes to
 * `core.transactions` while it builds. The migration runs without a wrapping
 * transaction, so that lasts one index at a time rather than for the whole
 * migration. That is fine at personal-finance volumes; a much larger ledger
 * should build them `CONCURRENTLY`. Safe to re-run: an index that exists is
 * skipped without touching the table.
 *
 * @param db - Migration connection (database owner).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await createIndexIfMissing(
    db,
    'core.ix_transactions_account_amount',
    'ON core.transactions (account_id) INCLUDE (user_id, amount)',
  )
  // The covering index above serves every lookup the plain one did.
  const { rows } = await sql<{ found: boolean }>`
    SELECT to_regclass('core.ix_transactions_account_id') IS NOT NULL AS found
  `.execute(db)
  if (rows[0]?.found === true) await sql`DROP INDEX IF EXISTS core.ix_transactions_account_id`.execute(db)
  await createIndexIfMissing(
    db,
    'core.ix_transactions_account_date',
    'ON core.transactions (account_id, transaction_date DESC)',
  )
  await createIndexIfMissing(
    db,
    'core.ix_transactions_transfer_account_id',
    'ON core.transactions (transfer_account_id) WHERE transfer_account_id IS NOT NULL',
  )
  await createIndexIfMissing(
    db,
    'core.ix_transactions_uncategorized',
    'ON core.transactions (user_id, id) WHERE category_id IS NULL AND transfer_id IS NULL',
  )
  await createIndexIfMissing(
    db,
    'core.ix_transactions_user_amount',
    'ON core.transactions (user_id, amount)',
  )
  await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`.execute(db)
  await createIndexIfMissing(
    db,
    'core.ix_transactions_merchant_trgm',
    'ON core.transactions USING gin (merchant gin_trgm_ops)',
  )
}

/**
 * Tells the migrator to run this migration without wrapping it in a
 * transaction, so each index build holds its lock alone. Every step is
 * idempotent.
 */
export const transactional = false

/**
 * Drops the indexes added by {@link up} and restores the plain `account_id` index.
 * The `pg_trgm` extension is left installed, since other objects may use it.
 *
 * @param db - Migration connection (database owner).
 */
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS core.ix_transactions_merchant_trgm`.execute(db)
  await sql`DROP INDEX IF EXISTS core.ix_transactions_user_amount`.execute(db)
  await sql`DROP INDEX IF EXISTS core.ix_transactions_uncategorized`.execute(db)
  await sql`DROP INDEX IF EXISTS core.ix_transactions_transfer_account_id`.execute(db)
  await sql`DROP INDEX IF EXISTS core.ix_transactions_account_date`.execute(db)
  await sql`CREATE INDEX IF NOT EXISTS ix_transactions_account_id ON core.transactions (account_id)`.execute(db)
  await sql`DROP INDEX IF EXISTS core.ix_transactions_account_amount`.execute(db)
}
