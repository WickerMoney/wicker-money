import type { ExportedBatchTransaction } from './ExportedBatchTransaction.js'
import type { ExportedImportBatch } from './ExportedImportBatch.js'
import type { ExportedSourceMapping } from './ExportedSourceMapping.js'
import type { ExportRepository } from './ExportRepository.js'
import type { ImportExport } from './ImportExport.js'
import type { Query } from './Query.js'

/** {@link ExportRepository} over the plugin's query runner. */
export class QueryExportRepository implements ExportRepository {
  /** @param q - A query runner bound to the current user. */
  constructor(private readonly q: Query) {}

  /** @inheritdoc */
  async readAll(): Promise<ImportExport> {
    const sourceMappings = await this.q<ExportedSourceMapping>`
      SELECT id, source_name, columns, date_format, amount_style, invert_amount,
             created_at, updated_at
      FROM plugin_import_csv.source_mappings
      ORDER BY source_name
    `
    const importBatches = await this.q<ExportedImportBatch>`
      SELECT id, account_id, source_name, file_name, rows_total, rows_imported,
             rows_skipped, rows_flagged, created_at, reverted_at, idempotency_key
      FROM plugin_import_csv.import_batches
      ORDER BY created_at
    `
    const batchTransactions = await this.q<ExportedBatchTransaction>`
      SELECT batch_id, transaction_id
      FROM plugin_import_csv.batch_transactions
    `
    return { sourceMappings, importBatches, batchTransactions }
  }
}
