import type { BatchOutcome } from './BatchOutcome.js'
import type { BatchListRow } from './BatchListRow.js'
import type { BatchRecord } from './BatchRecord.js'
import type { BatchRepository } from './BatchRepository.js'
import type { NewBatch } from './NewBatch.js'
import type { Query } from './Query.js'

/** {@link BatchRepository} over the plugin's query runner. */
export class QueryBatchRepository implements BatchRepository {
  /** @param q - A query runner bound to the current user. */
  constructor(private readonly q: Query) {}

  /** @inheritdoc */
  listRecent(limit: number): Promise<BatchListRow[]> {
    return this.q<BatchListRow>`
      SELECT b.id, b.source_name AS "sourceName", b.file_name AS "fileName",
             b.rows_total AS "rowsTotal", b.rows_imported AS "rowsImported",
             b.rows_skipped AS "rowsSkipped", b.rows_flagged AS "rowsFlagged",
             b.created_at AS "createdAt", b.reverted_at AS "revertedAt",
             a.name AS "accountName"
      FROM plugin_import_csv.import_batches b
      JOIN core.accounts a ON a.id = b.account_id
      ORDER BY b.created_at DESC
      LIMIT ${limit}
    `
  }

  /** @inheritdoc */
  async create(batch: NewBatch): Promise<string | undefined> {
    const rows = await this.q<{ id: string }>`
      INSERT INTO plugin_import_csv.import_batches
        (user_id, account_id, source_name, file_name,
         rows_total, rows_imported, rows_skipped, rows_flagged, idempotency_key)
      VALUES (core.current_user_id(), ${batch.accountId}, ${batch.sourceName}, ${batch.fileName},
              ${batch.rowsTotal}, ${batch.rowsImported}, ${batch.rowsSkipped}, ${batch.rowsFlagged},
              ${batch.idempotencyKey ?? null})
      RETURNING id
    `
    return rows[0]?.id
  }

  /** @inheritdoc */
  async findByIdempotencyKey(key: string): Promise<BatchOutcome | undefined> {
    const rows = await this.q<BatchOutcome>`
      SELECT id, rows_imported AS "rowsImported", rows_skipped AS "rowsSkipped",
             rows_flagged AS "rowsFlagged"
      FROM plugin_import_csv.import_batches
      WHERE user_id = core.current_user_id() AND idempotency_key = ${key}
    `
    return rows[0]
  }

  /** @inheritdoc */
  async findById(id: string): Promise<BatchRecord | undefined> {
    const rows = await this.q<{ id: string; revertedAt: Date | string | null }>`
      SELECT id, reverted_at AS "revertedAt"
      FROM plugin_import_csv.import_batches
      WHERE id = ${id}
    `
    return rows[0]
  }

  /** @inheritdoc */
  async markReverted(id: string): Promise<void> {
    await this.q`
      UPDATE plugin_import_csv.import_batches SET reverted_at = now() WHERE id = ${id}
    `
  }
}
