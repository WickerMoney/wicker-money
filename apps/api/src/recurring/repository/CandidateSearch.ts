import type { CandidateTransactionRow } from './CandidateTransactionRow.js'

/** What a candidate query found, and whether it had to stop short. */
export interface CandidateSearch {
  /** The transactions, ordered by date, then id. */
  readonly rows: CandidateTransactionRow[]
  /** The accounts that had more matching transactions than the cap allows; the oldest were left out. */
  readonly truncatedAccounts: readonly string[]
}
