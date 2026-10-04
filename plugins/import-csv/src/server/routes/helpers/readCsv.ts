import { ImportError } from '../../service/ImportError.js'
import { MAX_CSV_BYTES } from './MAX_CSV_BYTES.js'

/**
 * Validates the CSV text in a request body.
 *
 * The 8 MB ceiling (measured in bytes, as the message says) is far beyond any
 * statement export; a larger file is a sign of the wrong file.
 *
 * @param body - The request body, with `csv` still unchecked.
 * @returns The CSV text, unmodified.
 * @throws {ImportError} `400` when `csv` is not a non-blank string or is larger
 *   than `MAX_CSV_BYTES` bytes.
 */
export function readCsv(body: { csv?: unknown }): string {
  if (typeof body.csv !== 'string' || body.csv.trim() === '') {
    throw ImportError.field(['csv'], 'Choose a file with at least one row.')
  }
  // Every UTF-8 character is at least one byte, so a string with more
  // characters than the limit is too large without measuring it.
  if (body.csv.length > MAX_CSV_BYTES || Buffer.byteLength(body.csv, 'utf8') > MAX_CSV_BYTES) {
    throw new ImportError('That file is larger than 8 MB. Split it and import in parts.')
  }
  return body.csv
}
