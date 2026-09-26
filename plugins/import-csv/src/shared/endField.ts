import type { CsvParserState } from './CsvParserState.js'

/**
 * Closes the field being built and appends it to the current row.
 *
 * @param state - The parser state, mutated in place.
 */
export function endField(state: CsvParserState): void {
  state.row.push(state.field)
  state.field = ''
}
