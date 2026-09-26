import type { ParsedCsv } from './csv.js'
import { mapRow } from './mapRow.js'
import type { MapResult, MappedRow, RowError, SourceMapping } from './mapping.js'
import { readColumnIndexes } from './readColumnIndexes.js'

/**
 * Applies a mapping to CSV text that has already been parsed.
 *
 * Parsing dominates the cost of mapping a large file, and a mapping screen
 * re-maps on every change of a dropdown. Parsing once and mapping the result
 * lets the caller pay for the parse once per file. The mapping's `sourceName`
 * plays no part in the result.
 *
 * @param parsed - The output of `parseCsv`.
 * @param mapping - How to read it.
 * @returns The mapped rows and the per-row errors; row numbers count the header, so the first data row is 2.
 */
export function mapParsedRows(parsed: ParsedCsv, mapping: SourceMapping): MapResult {
  const idx = readColumnIndexes(parsed.headers, mapping.columns)

  const mapped: MappedRow[] = []
  const errors: RowError[] = []
  parsed.rows.forEach((raw, i) => {
    // 1-based, and +1 again for the header, so this matches what a spreadsheet
    // shows the user when they go looking for the offending line.
    const result = mapRow(raw, i + 2, idx, mapping)
    if ('field' in result) errors.push(result)
    else mapped.push(result)
  })
  return { rows: mapped, errors }
}
