import { QueryExportRepository } from './repository/QueryExportRepository.js'
import type { ImportExport } from './repository/ImportExport.js'
import type { Query } from '@wickermoney/plugin-sdk/server'

/**
 * Reads everything this plugin stores for the calling user, for the host's
 * "export all data" feature.
 *
 * The plugin owns its tables, so it reads them itself instead of the host
 * querying plugin schemas it knows nothing about. `batch_transactions` is
 * included even though it holds only ids that also appear in the host's own
 * transaction export, because "which import batch produced this row" is a fact a
 * re-import should be able to restore.
 *
 * @param q - A query runner bound to the current user and this plugin's role.
 * @returns The user's saved mappings, import batches and batch-to-transaction links.
 */
export function exportImportData(q: Query): Promise<ImportExport> {
  return new QueryExportRepository(q).readAll()
}
