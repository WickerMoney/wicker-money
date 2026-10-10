import { addMoney, subtractMoney, ZERO_MONEY } from '@wickermoney/plugin-sdk/money'
import { addDays } from '@wickermoney/plugin-sdk/date'
import { monthKeyOf, monthPeriod, shiftMonth } from './period.js'

/**
 * Windows: one budget line funded once and spent down over a date range that
 * can cross months, such as holiday gifts from October 1 through December 25.
 *
 * A window is not a new kind of row. It is a budget line whose period is not
 * exactly one calendar month. Migration 011 stored the period as two dates
 * precisely so that a different cadence would be a change in what gets
 * written. Deriving "is a window" from the dates means no flag can disagree
 * with them.
 *
 * In any one month a window reports what a hand-built rollover chain would
 * have: the whole amount is planned in the month the window starts, later
 * months plan nothing and carry in what is left, and each month's spend comes
 * off that. The month totals then count the funding once, not once per month,
 * and "left" in December is simply what is left of the pot. Unlike the
 * hand-built chain, there are no zero lines to create each month and no "copy
 * last month" that silently funds the pot twice.
 *
 * Pace is measured over the whole window, not over the month, because buying
 * half the gifts in November is not overspending November. It is shown on
 * the bar but does not make a window "at risk": the spending is lumpy by
 * design, so only an overdrawn pot changes its health.
 */

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const DAY_MS = 86_400_000

/** The longest window accepted, in calendar months. Long enough for a yearly fund; short enough to catch a mistyped year. */
export const MAX_WINDOW_MONTHS = 24

/**
 * Tests whether a string is a real calendar date (`2026-02-30` is not).
 *
 * @param value - Any string.
 * @returns `true` for a valid `YYYY-MM-DD` date.
 */
export function isDate(value: string): boolean {
  const m = DATE.exec(value)
  if (m === null) return false
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return new Date(t).toISOString().slice(0, 10) === value
}

/** Whole days from `a` to `b` (`b - a`). Both must be valid dates. */
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS)
}

/**
 * Tests whether a half-open period is exactly one calendar month, which is
 * what makes a line monthly rather than a window.
 *
 * @param start - Inclusive start, `YYYY-MM-DD`.
 * @param end - Exclusive end, `YYYY-MM-DD`.
 * @returns `true` when `start` is a first of the month and `end` the first of the next.
 */
export function isCalendarMonth(start: string, end: string): boolean {
  if (!isDate(start)) return false
  const period = monthPeriod(monthKeyOf(start))
  return period.start === start && period.end === end
}

/**
 * Explains what is wrong with a proposed window, if anything, and which of
 * its two dates to show it on.
 *
 * Shared by the window form and the server, so the browser refuses exactly
 * what the API refuses, in the same words.
 *
 * @param start - First day of the window, `YYYY-MM-DD`.
 * @param through - Last day of the window, inclusive, `YYYY-MM-DD`. Inclusive
 *   because that is how people say it ("through December 25"); it is stored
 *   as the half-open end the day after.
 * @returns The field and a sentence safe to show the user, or `null` when the
 *   window is acceptable.
 */
export function windowIssue(start: string, through: string): { field: 'start' | 'through'; message: string } | null {
  if (!isDate(start)) return { field: 'start', message: 'Must be a date like 2026-10-01.' }
  if (!isDate(through)) return { field: 'through', message: 'Must be a date like 2026-12-25.' }
  if (through < start) return { field: 'through', message: 'The window ends before it starts.' }
  const end = addDays(through, 1)
  if (isCalendarMonth(start, end)) {
    return {
      field: 'through',
      message: 'That window is exactly one calendar month. Add it as a normal line on that month instead.',
    }
  }
  if (end > monthPeriod(shiftMonth(monthKeyOf(start), MAX_WINDOW_MONTHS)).start) {
    return { field: 'through', message: `A window can be at most ${MAX_WINDOW_MONTHS} months long.` }
  }
  return null
}

/**
 * Explains what is wrong with a proposed window, if anything.
 *
 * @param start - First day of the window, `YYYY-MM-DD`.
 * @param through - Last day of the window, inclusive, `YYYY-MM-DD`.
 * @returns A sentence safe to show the user, or `null` when the window is acceptable.
 * @see windowIssue for which date the problem is on.
 */
export function windowProblem(start: string, through: string): string | null {
  return windowIssue(start, through)?.message ?? null
}

/**
 * How far through a window a day is, from 0 to 1.
 *
 * Counts today itself, like `elapsedFraction` does for a month: on the first
 * day of a 90-day window, 1/90 of it has elapsed, not none.
 *
 * @param start - Inclusive start, `YYYY-MM-DD`.
 * @param end - Exclusive end, `YYYY-MM-DD`.
 * @param today - The day to measure at, `YYYY-MM-DD`.
 * @returns 0 before the window, 1 once it has ended.
 */
export function windowElapsed(start: string, end: string, today: string): number {
  if (today < start) return 0
  if (today >= end) return 1
  return (daysBetween(start, today) + 1) / daysBetween(start, end)
}

/**
 * The day a month's figures are "as of": today while the month is current or
 * still ahead, its last day once it is over. A past month is judged as it
 * stood when it closed, not as the window stands now.
 *
 * @param monthKey - The month being shown, `YYYY-MM`.
 * @param today - Today's date, `YYYY-MM-DD`.
 * @returns A `YYYY-MM-DD` date.
 */
export function asOfInMonth(monthKey: string, today: string): string {
  const { end } = monthPeriod(monthKey)
  return today < end ? today : addDays(end, -1)
}

/** What {@link windowMonth} needs about one window and one month. */
export interface WindowMonthInput {
  /** Inclusive start of the window, `YYYY-MM-DD`. */
  readonly start: string
  /** The amount the window was funded with, as a decimal string. */
  readonly funded: string
  /** The month being shown, `YYYY-MM`. */
  readonly monthKey: string
  /** Spent in the window before this month, as a decimal string. */
  readonly spentBefore: string
  /** Spent in the window during this month, as a decimal string. */
  readonly spentInMonth: string
}

/** One window's figures for one month. Every amount is a decimal string. */
export interface WindowMonth {
  /** The funded amount in the month the window starts, zero after. */
  readonly planned: string
  /** What is left of the pot coming into this month; zero in the first month. */
  readonly carriedIn: string
  /** `planned + carriedIn`. */
  readonly available: string
  /** Spent in the window during this month. */
  readonly spent: string
  /** `available - spent`: what is left of the pot after this month. */
  readonly remaining: string
  /** Spent in the window from its start through this month. */
  readonly spentToDate: string
}

/**
 * Computes one window's figures for a month it overlaps.
 *
 * @param input - The window, the month, and what was spent before and during it.
 * @returns The month's figures, shaped like a monthly line's.
 * @throws {RangeError} If a date or amount is malformed.
 */
export function windowMonth(input: WindowMonthInput): WindowMonth {
  const first = monthKeyOf(input.start) === input.monthKey
  const planned = first ? input.funded : ZERO_MONEY
  const carriedIn = first ? ZERO_MONEY : subtractMoney(input.funded, input.spentBefore)
  const available = addMoney(planned, carriedIn)
  return {
    planned,
    carriedIn,
    available,
    spent: input.spentInMonth,
    remaining: subtractMoney(available, input.spentInMonth),
    spentToDate: addMoney(input.spentBefore, input.spentInMonth),
  }
}
