import type { OccurrenceLegView, OccurrenceView } from './OccurrenceView.js'

/** One account's outlook to the next payday. */
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
  /**
   * Whether the account is spendable and so counts toward `safeToSpend`. An
   * account that is not counted is still projected and can still be short.
   */
  readonly counted: boolean
}

/** A leg of an upcoming occurrence, with the name of the account it is on. */
export interface UpcomingLegView extends OccurrenceLegView {
  /**
   * The account's name, archived or not, so a client can describe a transfer
   * to an account that is not in {@link UpcomingView.accounts} without a second request.
   */
  readonly accountName: string
}

/** An occurrence in the upcoming window: its legs also carry account names. */
export interface UpcomingOccurrenceView extends Omit<OccurrenceView, 'legs'> {
  readonly legs: readonly UpcomingLegView[]
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
   * Sum of the positive headrooms across counted (spendable) accounts. An
   * account that is short is never netted against another's surplus; it is
   * listed with `short: true` instead. Zero when nothing is counted.
   */
  readonly safeToSpend: string
  /** Active checking accounts and spendable savings accounts: counted first, then by name. */
  readonly accounts: readonly UpcomingAccount[]
  /** Every occurrence in the window, all kinds; a client chooses which to list. */
  readonly occurrences: readonly UpcomingOccurrenceView[]
  /** Whether the user has any recurring item at all, ended ones included. */
  readonly hasItems: boolean
}
