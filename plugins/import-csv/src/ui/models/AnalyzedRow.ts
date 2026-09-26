import type { RowStatus } from '../../shared/index.js'

/** One file row after duplicate analysis. */
export interface AnalyzedRow {
  /** The row's position in the file, counting the header as row 1. */
  readonly rowNumber: number
  /** ISO date, `YYYY-MM-DD`. */
  readonly date: string
  readonly merchant: string
  /** Signed decimal string. */
  readonly amount: string
  readonly notes: string | null
  /** The source's own transaction id, when the file has one. */
  readonly externalId: string | null
  readonly status: RowStatus
  /** Why the row was flagged or skipped. */
  readonly reason: string | null
  /** The existing transaction this row appears to duplicate, if any. */
  readonly matched: { id: string; date: string; merchant: string; amount: string } | null
}
