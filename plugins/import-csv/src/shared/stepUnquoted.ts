import type { CsvParserState } from './CsvParserState.js'
import { endField } from './endField.js'
import { endRow } from './endRow.js'

/**
 * Consumes one character outside a quoted field.
 *
 * A quote at the very start of a field opens quoting; a delimiter ends the
 * field; a line terminator ends the row, with CRLF consumed as one so Windows
 * exports do not gain a stray `\r` on the last field of every row.
 *
 * @param state - The parser state, mutated in place.
 * @param src - The CSV text being parsed.
 * @param delimiter - The field delimiter.
 */
export function stepUnquoted(state: CsvParserState, src: string, delimiter: string): void {
  const ch = src[state.i]!
  if (ch === '"' && state.field === '') {
    state.inQuotes = true
  } else if (ch === delimiter) {
    endField(state)
  } else if (ch === '\r') {
    if (src[state.i + 1] === '\n') state.i += 1
    endRow(state)
  } else if (ch === '\n') {
    endRow(state)
  } else {
    state.field += ch
  }
  state.i += 1
}
