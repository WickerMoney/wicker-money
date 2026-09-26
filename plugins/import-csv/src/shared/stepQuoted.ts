import type { CsvParserState } from './CsvParserState.js'

/**
 * Consumes one character inside a quoted field.
 *
 * A doubled quote is a literal quote; a single quote closes the field's
 * quoting. Everything else, delimiters and newlines included, is field text.
 *
 * @param state - The parser state, mutated in place.
 * @param src - The CSV text being parsed.
 */
export function stepQuoted(state: CsvParserState, src: string): void {
  const ch = src[state.i]!
  if (ch !== '"') {
    state.field += ch
    state.i += 1
  } else if (src[state.i + 1] === '"') {
    state.field += '"'
    state.i += 2
  } else {
    state.inQuotes = false
    state.i += 1
  }
}
