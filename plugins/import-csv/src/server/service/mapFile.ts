import { mapRows, type MapResult, type SourceMapping } from '../../shared/index.js'
import { ImportError } from './ImportError.js'

/**
 * Maps a file's rows, refusing one that is too large to import in a single request.
 *
 * @param csv - The CSV text.
 * @param mapping - How to read it.
 * @param maxRows - The most data rows (mapped or not) one import may contain.
 * @returns The mapped rows and per-row errors.
 * @throws {ImportError} `400` (`too_many_rows`) when the file has more than `maxRows` data rows.
 */
export function mapFile(csv: string, mapping: SourceMapping, maxRows: number): MapResult {
  const mapped = mapRows(csv, mapping)
  const total = mapped.rows.length + mapped.errors.length
  if (total > maxRows) {
    throw new ImportError(
      `That file has ${total.toLocaleString('en-US')} rows; the limit is ` +
        `${maxRows.toLocaleString('en-US')} per import. Split it and import in parts.`,
      400,
      'too_many_rows',
    )
  }
  return mapped
}
