import type { ExistingTransaction } from '../../shared/index.js'
import { INSERT_CHUNK_SIZE } from './INSERT_CHUNK_SIZE.js'
import { chunk } from './chunk.js'
import type { LedgerRepository } from './LedgerRepository.js'
import type { NewLedgerRow } from './NewLedgerRow.js'
import type { Query } from '@wickermoney/plugin-sdk/server'

/** {@link LedgerRepository} over the plugin's query runner. */
export class QueryLedgerRepository implements LedgerRepository {
  /** @param q - A query runner bound to the current user. */
  constructor(private readonly q: Query) {}

  /** @inheritdoc */
  findInWindow(accountId: string, from: string, to: string): Promise<ExistingTransaction[]> {
    return this.q<ExistingTransaction>`
      SELECT id, transaction_date::text AS date, merchant, amount::text AS amount,
             external_id AS "externalId"
      FROM core.transactions
      WHERE account_id = ${accountId}
        AND transaction_date BETWEEN ${from}::date AND ${to}::date
    `
  }

  /** @inheritdoc */
  async insertImported(accountId: string, rows: readonly NewLedgerRow[]): Promise<string[]> {
    const ids: string[] = []
    for (const slice of chunk(rows, INSERT_CHUNK_SIZE)) {
      ids.push(...(await this.insertChunk(accountId, slice)))
    }
    return ids
  }

  /** @inheritdoc */
  async deleteUntouchedInBatch(batchId: string): Promise<number> {
    // updated_at equals created_at until something edits the row: both come
    // from the same statement's default. A hand-made category, a split or a
    // transfer conversion are checked directly as well, so the test does not
    // depend on every writer remembering to stamp the row.
    const removed = await this.q<{ id: string }>`
      DELETE FROM core.transactions
      WHERE id IN (
          SELECT transaction_id FROM plugin_import_csv.batch_transactions WHERE batch_id = ${batchId}
        )
        AND updated_at <= created_at
        AND NOT is_split
        AND transfer_account_id IS NULL
        AND (category_source IS NULL OR category_source = 'rule')
      RETURNING id
    `
    return removed.length
  }

  /** @inheritdoc */
  async countInBatch(batchId: string): Promise<number> {
    const rows = await this.q<{ n: number }>`
      SELECT count(*)::int AS n
      FROM core.transactions
      WHERE id IN (
        SELECT transaction_id FROM plugin_import_csv.batch_transactions WHERE batch_id = ${batchId}
      )
    `
    return rows[0]?.n ?? 0
  }

  /** Writes one chunk as a single statement over parallel arrays. */
  private async insertChunk(accountId: string, rows: readonly NewLedgerRow[]): Promise<string[]> {
    const inserted = await this.q<{ id: string }>`
      INSERT INTO core.transactions
        (user_id, account_id, amount, merchant, transaction_date, notes, external_id,
         category_id, category_source)
      SELECT core.current_user_id(), ${accountId}::uuid, r.amount, r.merchant, r.txn_date, r.notes,
             r.external_id, r.category_id,
             (CASE WHEN r.category_id IS NULL THEN NULL ELSE 'rule' END)::core.category_source
      FROM unnest(
        ${rows.map((r) => r.amount)}::numeric[],
        ${rows.map((r) => r.merchant)}::text[],
        ${rows.map((r) => r.date)}::date[],
        ${rows.map((r) => r.notes)}::text[],
        ${rows.map((r) => r.externalId)}::text[],
        ${rows.map((r) => r.categoryId)}::uuid[]
      ) WITH ORDINALITY AS r(amount, merchant, txn_date, notes, external_id, category_id, position)
      ORDER BY r.position
      ON CONFLICT (account_id, external_id) WHERE external_id IS NOT NULL DO NOTHING
      RETURNING id
    `
    return inserted.map((r) => r.id)
  }
}
