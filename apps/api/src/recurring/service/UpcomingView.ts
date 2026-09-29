import type { OccurrenceView } from './OccurrenceView.js'

/** One checking account's outlook to the next payday. */
export interface UpcomingAccount {
  readonly accountId: string
  readonly name: string
  /** Today's actual balance: the projection starts from it. */
  readonly balance: string
  readonly buffer: string
  /**
   * The lowest the balance gets between now and payday (inclusive), with
   * each day's outflows clearing before its inflows, and the day it happens.
   * Today's balance counts too: an account already under its buffer is short now.
   */
  readonly lowest: { readonly date: string; readonly balance: string }
  /** `lowest.balance − buffer`. Negative means short. */
  readonly headroom: string
  readonly short: boolean
}

/** Everything the upcoming widget shows, computed on the server. */
export interface UpcomingView {
  /** The user's today in their time zone. */
  readonly today: string
  readonly window: {
    /** Tomorrow: today's balance already reflects anything that posted today. */
    readonly from: string
    /** Last day included: payday, or 14 days out when no income is expected. */
    readonly through: string
    /** The household's next payday (any income, any account), or `null`. */
    readonly payday: string | null
  }
  /**
   * Sum of the positive headrooms across checking accounts. An account that
   * is short is never netted against another's surplus; it is listed with
   * `short: true` instead.
   */
  readonly safeToSpend: string
  /** Active checking accounts, in name order. */
  readonly accounts: readonly UpcomingAccount[]
  /** Every occurrence in the window, all kinds; a client chooses which to list. */
  readonly occurrences: readonly OccurrenceView[]
  /** Whether the user has any recurring item at all, ended ones included. */
  readonly hasItems: boolean
}
