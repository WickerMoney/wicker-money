import type { RecurringOccurrence } from './RecurringOccurrence.js'

/** A transaction that could settle one leg of an occurrence. */
export interface MatchCandidate {
  readonly transactionId: string
  readonly date: string
  /** What posted, signed. */
  readonly amount: string
  readonly merchant: string
  /** Days from the expected date: negative is early. */
  readonly dayDifference: number
  /** What posted minus what was expected, signed. */
  readonly amountDifference: string
  /** Close enough in date and amount to suggest unprompted. */
  readonly confident: boolean
}

/** `GET /recurring-items/:id/occurrences/:date/candidates`. */
export interface OccurrenceCandidates {
  readonly today: string
  readonly occurrence: RecurringOccurrence
  readonly legs: readonly {
    readonly accountId: string
    readonly amount: string
    /** Best first. */
    readonly candidates: readonly MatchCandidate[]
  }[]
}

/** One suggested match, waiting for the user to confirm it. */
export interface MatchSuggestion {
  readonly occurrence: RecurringOccurrence
  /** The leg's account. */
  readonly accountId: string
  readonly candidate: MatchCandidate
}

/** `GET /recurring-items/suggestions`. */
export interface MatchSuggestionList {
  readonly today: string
  readonly suggestions: readonly MatchSuggestion[]
}
