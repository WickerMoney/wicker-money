/**
 * How often a recurring item repeats, in declaration order.
 *
 * Mirrors `core.recurrence_frequency` plus `once`, the one-off future item.
 * Every function in this module throws on a value outside this list rather
 * than skipping the item, so an unknown frequency can never silently drop out
 * of a forecast.
 */
export const RECURRENCE_FREQUENCIES = [
  'once', 'daily', 'weekly', 'biweekly', 'semimonthly', 'monthly', 'quarterly', 'annual',
] as const
/** One of the values in `RECURRENCE_FREQUENCIES`. */
export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number]

/** The two days a `semimonthly` item uses when none are given: the 1st and the 15th. */
export const DEFAULT_SEMIMONTHLY_DAYS: readonly [number, number] = [1, 15]

/**
 * When a recurring item happens. Only the schedule; no amounts or accounts.
 *
 * All dates are calendar dates as `YYYY-MM-DD`, with no time or time zone.
 */
export interface RecurrenceSchedule {
  /** How often it repeats. */
  readonly frequency: RecurrenceFrequency
  /**
   * The immutable anchor every occurrence is computed from; never advanced.
   *
   * For every frequency except `semimonthly` this is the first occurrence, and
   * its day of month (or weekday) sets all the others. For `semimonthly` it is
   * only the earliest date an occurrence may fall on; the days come from
   * `semimonthlyDays`.
   */
  readonly seriesStartDate: string
  /**
   * Last date an occurrence may fall on, inclusive. An occurrence exactly on
   * this date happens. `null` or absent for a series with no planned end.
   */
  readonly endDate?: string | null
  /**
   * The two days of the month a `semimonthly` item falls on, each 1-31.
   * A day past the end of a short month clamps to its last day, so `[15, 31]`
   * means "the 15th and the last day". Defaults to `DEFAULT_SEMIMONTHLY_DAYS`;
   * ignored for every other frequency.
   */
  readonly semimonthlyDays?: readonly [number, number] | null
}

/** Where one part of a recurring item's money lands. */
export interface RecurringLeg {
  /** The account the amount is applied to. */
  readonly accountId: string
  /**
   * Signed amount as a `numeric(19,4)` decimal string, with the same sign
   * convention as transactions: negative leaves the account, positive arrives.
   */
  readonly amount: string
}

/**
 * A recurring item as the projection functions need it: a schedule plus the
 * legs it applies on every occurrence.
 *
 * A bill is one negative leg, income (including a split paycheck) is one or
 * more positive legs, and a transfer is two legs that net to zero. Any object
 * with these fields works; extra fields are ignored.
 */
export interface RecurringItem extends RecurrenceSchedule {
  /** The legs applied on each occurrence. */
  readonly legs: readonly RecurringLeg[]
  /**
   * Changes to single occurrences, keyed by nominal date (`YYYY-MM-DD`): the
   * date the schedule gives, which is what identifies an occurrence even after
   * it moves. A key that is not one of the schedule's dates is ignored, so an
   * override left behind by a schedule edit can never invent an occurrence.
   * `null` or absent when nothing is overridden.
   */
  readonly overrides?: Readonly<Record<string, OccurrenceOverride>> | null
}

/**
 * How one occurrence differs from its series.
 *
 * Every field is optional; an empty object changes nothing. A caller can use
 * these for anything that makes one occurrence differ: a month the user skips,
 * a bill that is larger this time, a payment that moved for a holiday, or (as
 * the Wicker Money API does) money that already arrived and must not be
 * projected again.
 */
export interface OccurrenceOverride {
  /** `true` drops the occurrence entirely: it is not listed and moves no money. */
  readonly skipped?: boolean
  /**
   * The date it is expected instead of the nominal one, `YYYY-MM-DD`. May be
   * earlier or later, including outside the range being asked about: an
   * occurrence is placed where it lands, not where it was scheduled.
   */
  readonly date?: string | null
  /**
   * The legs applied on this occurrence instead of the item's. An empty list
   * keeps the occurrence (it still happens on its date) but moves no money,
   * which is how an occurrence that has already fully posted is expressed.
   */
  readonly legs?: readonly RecurringLeg[] | null
}

/** One occurrence after overrides: when it lands and what it moves. */
export interface ScheduledOccurrence {
  /** The schedule's date for it, `YYYY-MM-DD`; its identity. */
  readonly nominalDate: string
  /** The date it lands, `YYYY-MM-DD`; the nominal date unless overridden. */
  readonly date: string
  /** The legs it applies: the override's if it has any, otherwise the item's. */
  readonly legs: readonly RecurringLeg[]
}

/** One day of a projected balance series. */
export interface DailyBalance {
  /** The day, `YYYY-MM-DD`. */
  readonly date: string
  /** Balance at the end of that day, as a four-decimal string. May be negative. */
  readonly balance: string
  /**
   * The lowest the balance gets that day, assuming the day's outflows clear
   * before its inflows land: the previous day's balance plus every negative
   * amount due that day. Equal to `balance` on a day with no inflow.
   *
   * Conservative on purpose. Rent due on payday is a real risk if the
   * paycheck lands late in the day, and an end-of-day figure would hide it.
   */
  readonly low: string
}

/** Money coming into and going out of a set of accounts over a period. */
export interface FlowTotals {
  /** Sum of occurrences that add money to the set, as a four-decimal string (zero or positive). */
  readonly inflow: string
  /** Sum of occurrences that take money out of the set, as a four-decimal string (zero or negative). */
  readonly outflow: string
  /** `inflow + outflow`. */
  readonly net: string
}
