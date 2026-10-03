import type { RecurringKind } from '../../db/models/index.js'
import type { ForecastHorizon } from './FORECAST_HORIZONS.js'
import type { OccurrenceStatus } from './OccurrenceStatus.js'

/** An account a forecast can be drawn for. */
export interface ForecastAccountOption {
  readonly accountId: string
  readonly name: string
  readonly accountType: string
}

/** The account a forecast is drawn for, with where it starts. */
export interface ForecastAccount extends ForecastAccountOption {
  /** Today's actual balance: the projection starts from it. */
  readonly balance: string
  /** The cushion the user keeps in the account (zero if none). */
  readonly buffer: string
  /**
   * Whether overdraft and buffer apply: checking and savings. For a card or
   * loan a negative balance is simply what is owed, so the breach fields and
   * day counts are `null`.
   */
  readonly cash: boolean
}

/** One projected day. */
export interface ForecastDay {
  readonly date: string
  /** End-of-day balance. */
  readonly balance: string
  /** Lowest point that day, with its outflows clearing before its inflows. */
  readonly low: string
}

/** A point in time where the balance crosses a line. */
export interface ForecastBreach {
  /** The first day it happens; today if the account is already there. */
  readonly date: string
  /** The balance at that point (that day's low). */
  readonly balance: string
}

/** Headline figures for the chart's stat tiles. */
export interface ForecastStats {
  /** Today's balance. */
  readonly start: string
  /** The balance at the end of the last day. */
  readonly end: string
  /** The lowest point, today included, and the first day it is reached. */
  readonly lowest: { readonly date: string; readonly balance: string }
  /** Projected days whose low is below zero. `null` for cards and loans. */
  readonly daysBelowZero: number | null
  /** Projected days whose low is below the buffer. `null` for cards and loans. */
  readonly daysBelowBuffer: number | null
  /** The first time the balance drops below zero. `null` if it never does, or for cards and loans. */
  readonly firstBelowZero: ForecastBreach | null
  /** The first time it drops below the buffer. `null` if it never does, if there is no buffer, or for cards and loans. */
  readonly firstBelowBuffer: ForecastBreach | null
}

/** One occurrence that moves the forecast account's balance. */
export interface ForecastEntry {
  readonly itemId: string
  /** The day it is projected on (a late occurrence is carried to the first projected day). */
  readonly date: string
  /** The schedule's date for it; with `itemId`, its identity. */
  readonly nominalDate: string
  readonly status: OccurrenceStatus
  readonly name: string
  readonly kind: RecurringKind
  /**
   * What this occurrence still does to this account: negative leaves it,
   * positive arrives. Zero when this account's leg has already posted.
   */
  readonly amount: string
  /** Every leg of the occurrence, so a transfer can show where the money goes or comes from. */
  readonly legs: readonly { readonly accountId: string; readonly amount: string }[]
}

/** Everything the forecast page shows, computed on the server. */
export interface ForecastView {
  /** The user's today in their time zone. */
  readonly today: string
  readonly horizon: ForecastHorizon
  readonly window: {
    /** Tomorrow: today's balance already reflects anything that posted today. */
    readonly from: string
    /** Last day included. */
    readonly through: string
  }
  /** Every active account, for the picker. */
  readonly accounts: readonly ForecastAccountOption[]
  /** The account forecast, or `null` when the user has no active account. */
  readonly account: ForecastAccount | null
  /** One entry per day from `window.from` through `window.through`; empty without an account. */
  readonly days: readonly ForecastDay[]
  /** `null` without an account. */
  readonly stats: ForecastStats | null
  /** Occurrences with a leg on the account, in date order. */
  readonly entries: readonly ForecastEntry[]
  /** Whether the user has any recurring item at all, ended ones included. */
  readonly hasItems: boolean
}
