import type { MatchCandidate } from './matchCandidates.js'
import type { MatchSuggestion } from './MatchSuggestion.js'
import type { OccurrenceView } from './OccurrenceView.js'

/** Where one transaction stands against recurring items, for a row of the transaction list. */
export interface TransactionMatchSummary {
  readonly transactionId: string
  /** The occurrence it settles, or `null`. */
  readonly linked: OccurrenceView | null
  /** The occurrence suggested for it, the same suggestion the Recurring page shows, or `null`. */
  readonly suggestion: MatchSuggestion | null
  /** Occurrences the user said it is not, so each can be undone. */
  readonly dismissed: readonly OccurrenceView[]
}

/**
 * `GET /recurring-items/transaction-matches`: one summary per requested
 * transaction that has anything to show (linked, suggested or dismissed).
 * Transactions with nothing, or not visible to the user, are left out.
 */
export interface TransactionMatchList {
  readonly today: string
  readonly transactions: readonly TransactionMatchSummary[]
}

/** One occurrence a transaction could settle. */
export interface TransactionCandidate {
  readonly occurrence: OccurrenceView
  /** The leg's account: the transaction's. */
  readonly accountId: string
  /** The transaction judged against this occurrence's leg. */
  readonly candidate: MatchCandidate
  /** The user dismissed this pair as a suggestion; it can still be matched by hand. */
  readonly dismissed: boolean
}

/** `GET /recurring-items/transaction-matches/:transactionId`. */
export interface TransactionCandidates {
  readonly today: string
  readonly transactionId: string
  /** The occurrence it already settles; when set, `candidates` is empty (unmatch first). */
  readonly linked: OccurrenceView | null
  /** Occurrences with an unsettled leg on its account, in its direction, within the match window; best first. */
  readonly candidates: readonly TransactionCandidate[]
}
