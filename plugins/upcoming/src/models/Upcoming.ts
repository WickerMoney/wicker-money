/** One leg of an occurrence: a signed amount on one account. */
export interface UpcomingLeg {
  readonly accountId: string
  /**
   * The account's name. Absent from servers older than names-on-legs; the data
   * hook then falls back to the account list.
   */
  readonly accountName?: string
  readonly amount: string
}

/**
 * Where an occurrence stands (paid / landed matching). Absent from servers
 * older than matching, which only ever listed what was still to come.
 */
export type OccurrenceStatus = 'upcoming' | 'due' | 'late' | 'missed' | 'cleared' | 'skipped' | 'assumed'

/** One occurrence of a recurring item inside the window. */
export interface UpcomingOccurrence {
  readonly itemId: string
  /** The day it is projected on; a late one is carried to the window's first day. */
  readonly date: string
  /** The schedule's date for it; with `itemId`, its identity. */
  readonly nominalDate?: string
  /** When it was expected (moved, or the nominal date). */
  readonly expectedDate?: string
  readonly status?: OccurrenceStatus
  readonly moved?: boolean
  readonly name: string
  readonly kind: 'income' | 'bill' | 'debt_payment' | 'transfer'
  readonly categoryId: string | null
  /** Income total, a bill's (negative) amount, or what a transfer moves (positive). */
  readonly amount: string
  readonly legs: readonly UpcomingLeg[]
}

/** One account's outlook to payday. */
export interface UpcomingAccount {
  readonly accountId: string
  readonly name: string
  readonly balance: string
  readonly buffer: string
  readonly lowest: { readonly date: string; readonly balance: string }
  /** `lowest − buffer`; negative when short. */
  readonly headroom: string
  readonly short: boolean
  /**
   * Whether the account counts toward `safeToSpend` (marked spendable on the
   * Accounts page). Absent from servers older than the setting, which counted
   * every account they listed; read it with {@link isCounted}.
   */
  readonly counted?: boolean
}

/** `GET /core/recurring-items/upcoming`: everything computed on the server. */
export interface UpcomingResponse {
  readonly today: string
  readonly window: { readonly from: string; readonly through: string; readonly payday: string | null }
  /** Sum of positive headroom across counted accounts; shortfalls are never netted away. */
  readonly safeToSpend: string
  readonly accounts: readonly UpcomingAccount[]
  readonly occurrences: readonly UpcomingOccurrence[]
  readonly hasItems: boolean
}

/** `GET /core/accounts/list`: names for legs that arrive without one (servers older than names-on-legs). */
export interface AccountListResponse {
  readonly accounts: readonly { readonly id: string; readonly name: string; readonly type: string }[]
}

/** What the widget's data hook returns. */
export interface UpcomingState {
  readonly data: UpcomingResponse | null
  /** Account names by id, for describing where money goes. */
  readonly accountNames: ReadonlyMap<string, string>
  readonly loading: boolean
  readonly error: string | null
}
