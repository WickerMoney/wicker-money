import type { MatchCandidate } from './matchCandidates.js'
import type { SettledBy } from './occurrenceState.js'
import type { OccurrenceView } from './OccurrenceView.js'

/** One leg of one occurrence and the transaction that most likely settled it. */
export interface MatchSuggestion {
  readonly occurrence: OccurrenceView
  /** The leg's account. */
  readonly accountId: string
  readonly candidate: MatchCandidate
}

/** A suggestion the user dismissed: the transaction is not this occurrence, and the pair is not offered again. */
export interface DismissedSuggestion {
  readonly occurrence: OccurrenceView
  /** The leg's account: the transaction's. */
  readonly accountId: string
  readonly transaction: SettledBy
}

/** Suggested matches plus the day they were worked out against. */
export interface MatchSuggestionList {
  readonly today: string
  /** Best first; each transaction and each leg appears at most once. */
  readonly suggestions: readonly MatchSuggestion[]
  /**
   * Dismissed pairs whose occurrence is in the same window and whose
   * transaction settles nothing, so a dismissal can be undone. Ordered by
   * expected date, then name.
   */
  readonly dismissed: readonly DismissedSuggestion[]
}

/** A candidate for one leg, and whether the user dismissed it as a suggestion. */
export interface OccurrenceCandidate extends MatchCandidate {
  /** Dismissed: never suggested, but it can still be matched by hand. */
  readonly dismissed: boolean
}

/** Every candidate for each leg of one occurrence that has not been settled yet. */
export interface OccurrenceCandidates {
  readonly today: string
  readonly occurrence: OccurrenceView
  readonly legs: readonly {
    readonly accountId: string
    /** Expected signed amount on this account. */
    readonly amount: string
    /** Best first. */
    readonly candidates: readonly OccurrenceCandidate[]
  }[]
}

/** The pairs a dismissal (or its undo) covered: the transaction and, for a transfer, its other row. */
export interface DismissalView {
  readonly itemId: string
  readonly nominalDate: string
  readonly transactionIds: readonly string[]
}
