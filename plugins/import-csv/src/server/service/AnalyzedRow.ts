import type { ExistingTransaction, RowStatus } from '../../shared/index.js'

/** One row of an analysis: what was read and what duplicate detection concluded. */
export interface AnalyzedRow {
  /** 1-based position in the file counting the header. */
  readonly rowNumber: number
  /** ISO `YYYY-MM-DD` date. */
  readonly date: string
  /** Merchant text. */
  readonly merchant: string
  /** Signed decimal string. */
  readonly amount: string
  /** Notes, or `null`. */
  readonly notes: string | null
  /** The source's own transaction id, or `null`. */
  readonly externalId: string | null
  /** The verdict. */
  readonly status: RowStatus
  /** Why the row got that verdict, or `null` for a new row. */
  readonly reason: string | null
  /** The existing transaction the row matched, or `null`. */
  readonly matched: ExistingTransaction | null
}
