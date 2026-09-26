import type { ExportedBatchTransaction } from './ExportedBatchTransaction.js'
import type { ExportedImportBatch } from './ExportedImportBatch.js'
import type { ExportedSourceMapping } from './ExportedSourceMapping.js'

/** Everything this plugin stores for one user. */
export interface ImportExport {
  /** The user's saved mappings. */
  readonly sourceMappings: readonly ExportedSourceMapping[]
  /** The user's import batches. */
  readonly importBatches: readonly ExportedImportBatch[]
  /** The links between batches and the transactions they created. */
  readonly batchTransactions: readonly ExportedBatchTransaction[]
}
