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
  readonly rows: readonly AnalyzedRow[]
  readonly errors: readonly { rowNumber: number; field: string; reason: string }[]
}
