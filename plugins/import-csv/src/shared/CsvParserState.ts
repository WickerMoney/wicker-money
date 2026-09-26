/** The mutable state of one CSV parse: finished rows, the row and field being built, and the read position. */
export interface CsvParserState {
  readonly rows: string[][]
  row: string[]
  field: string
  inQuotes: boolean
  /** Index of the next character to read. */
  i: number
}
