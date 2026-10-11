import type { AnalyzedRow } from './AnalyzedRow.js'

/** The response of the analyze endpoint: what committing the file would do. */
export interface AnalyzeResult {
  readonly summary: {
    readonly total: number
    readonly new: number
    /** Rows matched exactly by the source's transaction id; these are skipped. */
    readonly duplicate: number
    /** Rows that match an existing transaction only by amount, description and date. */
    readonly needsReview: number
    readonly errors: number
  }
  /** The first rows of the file, whatever their verdict. Not every row: `summary` counts the rest. */
  readonly rows: readonly AnalyzedRow[]
  /** The rows the user is asked to decide on, a page at a time. */
  readonly flagged: {
    /** Every possible duplicate in the file, not just the ones loaded so far. */
    readonly total: number
    /** Where `rows` starts in the file's list of possible duplicates. */
    readonly offset: number
    /** The possible duplicates loaded so far, in file order. */
    readonly rows: readonly AnalyzedRow[]
  }
  readonly errors: readonly { rowNumber: number; field: string; reason: string }[]
}
