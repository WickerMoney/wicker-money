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
