import type { MatchCandidate } from './matchCandidates.js'
import type { OccurrenceView } from './OccurrenceView.js'

/** One leg of one occurrence and the transaction that most likely settled it. */
export interface MatchSuggestion {
  readonly occurrence: OccurrenceView
  /** The leg's account. */
  readonly accountId: string
  readonly candidate: MatchCandidate
}

/** Suggested matches plus the day they were worked out against. */
export interface MatchSuggestionList {
  readonly today: string
  /** Best first; each transaction and each leg appears at most once. */
  readonly suggestions: readonly MatchSuggestion[]
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
    readonly candidates: readonly MatchCandidate[]
  }[]
}
