import { mapRows, type MapResult, type SourceMapping } from '../../shared/index.js'
import { ImportError } from './ImportError.js'
import { MAX_IMPORT_ROWS } from './MAX_IMPORT_ROWS.js'

/**
 * Maps a file's rows, refusing one that is too large to import in a single request.
 *
 * @param csv - The CSV text.
 * @param mapping - How to read it.
 * @returns The mapped rows and per-row errors.
 * @throws {ImportError} `400` when the file has more than `MAX_IMPORT_ROWS` data rows.
 */
export function mapFile(csv: string, mapping: SourceMapping): MapResult {
  const mapped = mapRows(csv, mapping)
  const total = mapped.rows.length + mapped.errors.length
  if (total > MAX_IMPORT_ROWS) {
    throw new ImportError(
      `That file has ${total.toLocaleString('en-US')} rows; the limit is ` +
        `${MAX_IMPORT_ROWS.toLocaleString('en-US')} per import. Split it and import in parts.`,
      400,
      'too_many_rows',
    )
  }
  return mapped
}
