import type { RecurringOccurrence, SettledTransaction } from './RecurringOccurrence.js'

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
  /** The user dismissed this pair as a suggestion; it can still be matched by hand. Absent from older servers. */
  readonly dismissed?: boolean
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

/** A suggestion the user dismissed, which is not offered again until undone. */
export interface DismissedSuggestion {
  readonly occurrence: RecurringOccurrence
  /** The leg's account: the transaction's. */
  readonly accountId: string
  readonly transaction: SettledTransaction
}

/** `GET /recurring-items/suggestions`. */
export interface MatchSuggestionList {
  readonly today: string
  readonly suggestions: readonly MatchSuggestion[]
  /** Dismissed pairs in the same window, to undo. Absent from older servers. */
  readonly dismissed?: readonly DismissedSuggestion[]
}

/** Where one transaction stands against recurring items. */
export interface TransactionMatchSummary {
  readonly transactionId: string
  /** The occurrence it settles. */
  readonly linked: RecurringOccurrence | null
  /** The occurrence suggested for it. */
  readonly suggestion: MatchSuggestion | null
  /** Occurrences the user said it is not. */
  readonly dismissed: readonly RecurringOccurrence[]
}

/** `GET /recurring-items/transaction-matches?transactionIds=...`: only transactions with something to show. */
export interface TransactionMatchList {
  readonly today: string
  readonly transactions: readonly TransactionMatchSummary[]
}

/** One occurrence a transaction could settle. */
export interface TransactionCandidate {
  readonly occurrence: RecurringOccurrence
  readonly accountId: string
  readonly candidate: MatchCandidate
  readonly dismissed: boolean
}

/** `GET /recurring-items/transaction-matches/:transactionId`. */
export interface TransactionCandidates {
  readonly today: string
  readonly transactionId: string
  /** The occurrence it already settles; `candidates` is then empty. */
  readonly linked: RecurringOccurrence | null
  /** Best first. */
  readonly candidates: readonly TransactionCandidate[]
}
