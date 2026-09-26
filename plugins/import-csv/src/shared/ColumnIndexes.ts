/** The position of each mapped column in the file's header, or `-1` for a column that is unmapped or missing. */
export interface ColumnIndexes {
  readonly date: number
  readonly merchant: number
  readonly amount: number
  readonly debit: number
  readonly credit: number
  readonly notes: number
  readonly externalId: number
}
