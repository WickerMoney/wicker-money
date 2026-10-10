import type { Decimal } from 'decimal.js'
import type { CandidateTransactionRow } from '../repository/CandidateTransactionRow.js'

/** A candidate transaction with its date and amount parsed at most once, however many legs it is ranked against. */
export interface ParsedCandidate {
  readonly row: CandidateTransactionRow
  /** The transaction date at UTC midnight, in milliseconds. */
  readonly dateMs: number
  /** The amount as a `Decimal`: built on first use, since most rows are ruled out before their amount is looked at. */
  amount(): Decimal
}
