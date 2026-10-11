/** Which flagged rows an analysis returns. */
export interface AnalyzePage {
  /** How many flagged rows to skip, in file order. */
  readonly offset: number
  /** The most flagged rows to return. */
  readonly limit: number
}
