/**
 * A CSV reader that handles what bank exports actually contain.
 *
 * Deliberately not a split on commas. Real statements carry quoted fields with
 * embedded commas ("AMAZON MKTPL, SEATTLE"), escaped quotes, CRLF line endings
 * from Windows tooling, a UTF-8 BOM from Excel, and occasionally a semicolon or
 * tab delimiter. Each of those turns a naive split into silently shifted
 * columns — amounts landing in the merchant field — rather than an error.
 *
 * Also deliberately not a dependency. The parsing rules are small and stable,
 * and the failure modes above are exactly the ones worth owning and testing.
 */

import type { CsvParserState } from './CsvParserState.js'
import { endRow } from './endRow.js'
import { stepQuoted } from './stepQuoted.js'
import { stepUnquoted } from './stepUnquoted.js'

const BOM = '﻿'

/** Delimiters worth guessing between, in preference order. */
const CANDIDATES = [',', ';', '\t', '|'] as const
/** One of the delimiters `detectDelimiter` can choose. */
export type Delimiter = (typeof CANDIDATES)[number]

/**
 * Infers the delimiter from the header line.
 *
 * Counting occurrences outside quotes is enough: a header row uses the
 * delimiter at least once and rarely contains the others. Unlike dates, a wrong
 * guess here is loud — the file parses as a single column — so inferring is
 * safe where guessing a date format is not. Falls back to a comma when the
 * header contains none of the candidates.
 *
 * @param text - The whole CSV text; only the first line is examined.
 * @returns The delimiter that appears most often outside quotes in the header.
 */
export function detectDelimiter(text: string): Delimiter {
  const header = text.replace(BOM, '').split(/\r?\n/, 1)[0] ?? ''
  let best: Delimiter = ','
  let bestCount = 0
  for (const d of CANDIDATES) {
    let count = 0
    let inQuotes = false
    for (let i = 0; i < header.length; i += 1) {
      const ch = header[i]
      if (ch === '"') inQuotes = !inQuotes
      else if (ch === d && !inQuotes) count += 1
    }
    if (count > bestCount) {
      best = d
      bestCount = count
    }
  }
  return best
}

/**
 * Splits CSV text into rows of raw string cells.
 *
 * Understands quoted fields (including embedded delimiters, newlines and
 * doubled quotes), CRLF and LF line endings, and a leading byte-order mark.
 * Blank lines are dropped.
 *
 * @param text - The CSV text.
 * @param delimiter - The delimiter to use; detected from the header when omitted.
 * @returns One array of cells per row, header row included, cells not trimmed.
 */
export function parseRows(text: string, delimiter?: Delimiter): string[][] {
  const src = text.startsWith(BOM) ? text.slice(1) : text
  const d = delimiter ?? detectDelimiter(src)

  const state: CsvParserState = { rows: [], row: [], field: '', inQuotes: false, i: 0 }
  while (state.i < src.length) {
    if (state.inQuotes) stepQuoted(state, src)
    else stepUnquoted(state, src, d)
  }

  if (state.field !== '' || state.row.length > 0) endRow(state)
  return state.rows
}

/** A CSV split into its header row and data rows. */
export interface ParsedCsv {
  /** The trimmed header names, in column order. */
  readonly headers: readonly string[]
  /** Data rows, each exactly as wide as `headers`, with cells trimmed. */
  readonly rows: readonly (readonly string[])[]
  /** The delimiter the text was parsed with, whether given or detected. */
  readonly delimiter: Delimiter
}

/**
 * Parses text into a header row plus data rows.
 *
 * Short rows are padded and long rows truncated to the header width. A ragged
 * file is common — trailing empty columns especially — and refusing the whole
 * import over it helps no one, while letting cells shift would be worse. Header
 * and cell text is trimmed.
 *
 * @param text - The CSV text.
 * @param delimiter - The delimiter to use; detected from the header when omitted.
 * @returns The trimmed headers, rectangular data rows, and the delimiter used.
 *   An empty input yields no headers and no rows.
 */
export function parseCsv(text: string, delimiter?: Delimiter): ParsedCsv {
  const d = delimiter ?? detectDelimiter(text)
  const all = parseRows(text, d)
  if (all.length === 0) return { headers: [], rows: [], delimiter: d }

  const headers = all[0]!.map((h) => h.trim())
  const width = headers.length
  const rows = all.slice(1).map((r) => {
    const cells = r.slice(0, width).map((c) => c.trim())
    while (cells.length < width) cells.push('')
    return cells
  })
  return { headers, rows, delimiter: d }
}
