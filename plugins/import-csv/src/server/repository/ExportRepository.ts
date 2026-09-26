import type { ImportExport } from './ImportExport.js'

/** Reads back everything the plugin stores, for the host's data export. */
export interface ExportRepository {
  /**
   * @returns The user's saved mappings, import batches and batch-to-transaction links.
   */
  readAll(): Promise<ImportExport>
}
