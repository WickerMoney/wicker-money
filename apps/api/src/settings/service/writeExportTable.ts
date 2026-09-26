import type { ExportRepository } from '../repository/ExportRepository.js'
import type { ExportTable } from '../repository/ExportTable.js'
import { EXPORT_PAGE_SIZE } from './EXPORT_PAGE_SIZE.js'
import type { ExportSink } from './ExportSink.js'

/**
 * Streams one table as a JSON object member, `,"<key>":[ ...rows... ]`.
 *
 * Rows are read a keyset page at a time and each page is written before the
 * next is read, so memory does not grow with the size of the table.
 *
 * @param exports - Repository used to read pages.
 * @param sink - Receives the text in order.
 * @param key - The member name in the document.
 * @param table - The table to stream.
 */
export async function writeExportTable(
  exports: Pick<ExportRepository, 'readPage'>,
  sink: ExportSink,
  key: string,
  table: ExportTable,
): Promise<void> {
  await sink.write(`,${JSON.stringify(key)}:[`)
  let afterId: string | undefined
  let first = true
  for (;;) {
    const rows = await exports.readPage(table, afterId, EXPORT_PAGE_SIZE)
    if (rows.length > 0) {
      await sink.write((first ? '' : ',') + rows.map((row) => JSON.stringify(row)).join(','))
      first = false
    }
    if (rows.length < EXPORT_PAGE_SIZE) break
    afterId = String(rows[rows.length - 1]?.['id'])
  }
  await sink.write(']')
}
