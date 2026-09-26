import type { CsvParserState } from './CsvParserState.js'
import { endField } from './endField.js'

/**
 * Closes the current row and appends it to the finished rows.
 *
 * @param state - The parser state, mutated in place.
 */
export function endRow(state: CsvParserState): void {
  endField(state)
  // A trailing newline produces one empty cell, which is not a row.
  if (!(state.row.length === 1 && state.row[0] === '')) state.rows.push(state.row)
  state.row = []
}
