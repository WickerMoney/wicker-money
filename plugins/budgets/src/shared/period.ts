/**
 * Calendar-month arithmetic on plain date strings.
 *
 * Everything here is `YYYY-MM-DD` text, never a `Date`. A `Date` carries an
 * instant and a zone, and the moment one enters this file the same month
 * boundary means a different thing depending on where the code runs — for
 * example, if months began at 00:00 UTC, Sunday-evening spending in New York
 * would land in the following week.
 *
 * The user's zone matters in precisely one place: deciding what "today" is, so
 * the page opens on the right month and pace is measured against the right day.
 * That is `todayIn` below, and it is the only function here that consults a
 * clock at all.
 */

/** A half-open month: `start` inclusive, `end` exclusive. */
export interface Period {
  /** First day of the period, inclusive, as `YYYY-MM-DD`. */
  readonly start: string
  /** First day after the period, exclusive, as `YYYY-MM-DD`. */
  readonly end: string
}

const MONTH_KEY = /^(\d{4})-(\d{2})$/
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * Tests whether a string is a well-formed month key.
 *
 * @param value - Any string.
 * @returns `true` for `YYYY-MM` with a month from 01 to 12, otherwise `false`.
 */
export function isMonthKey(value: string): boolean {
  if (!MONTH_KEY.test(value)) return false
  const month = Number(value.slice(5, 7))
  return month >= 1 && month <= 12
}

/**
 * Expands a month key into its half-open date range,
 * e.g. `2026-03` → `{ start: '2026-03-01', end: '2026-04-01' }`.
 *
 * @param monthKey - A `YYYY-MM` month key.
 * @returns The first day of the month (inclusive) and of the next month (exclusive).
 * @throws {RangeError} If `monthKey` is not a valid month key.
 */
export function monthPeriod(monthKey: string): Period {
  if (!isMonthKey(monthKey)) throw new RangeError(`Not a month: ${monthKey}`)
  const year = Number(monthKey.slice(0, 4))
  const month = Number(monthKey.slice(5, 7))
  const nextYear = month === 12 ? year + 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  return {
    start: `${pad4(year)}-${pad2(month)}-01`,
    end: `${pad4(nextYear)}-${pad2(nextMonth)}-01`,
  }
}

/**
 * Extracts the month key a calendar date belongs to.
 *
 * @param date - A `YYYY-MM-DD` date string.
 * @returns The `YYYY-MM` prefix of `date`.
 * @throws {RangeError} If `date` is not a `YYYY-MM-DD` string.
 */
export function monthKeyOf(date: string): string {
  if (!DATE.test(date)) throw new RangeError(`Not a date: ${date}`)
  return date.slice(0, 7)
}

/**
 * Moves a month key forwards or backwards by a whole number of months,
 * crossing year boundaries as needed.
 *
 * @param monthKey - The starting `YYYY-MM` month key.
 * @param by - Months to add; negative values move backwards.
 * @returns The resulting `YYYY-MM` month key.
 * @throws {RangeError} If `monthKey` is not a valid month key.
 */
export function shiftMonth(monthKey: string, by: number): string {
  if (!isMonthKey(monthKey)) throw new RangeError(`Not a month: ${monthKey}`)
  const year = Number(monthKey.slice(0, 4))
  const month = Number(monthKey.slice(5, 7))
  // Work in absolute months so a shift of -13 or +25 needs no loop and no
  // special case at the year boundary.
  const absolute = year * 12 + (month - 1) + by
  return `${pad4(Math.floor(absolute / 12))}-${pad2((absolute % 12) + 1)}`
}

/**
 * Returns the month key immediately before another.
 *
 * @param monthKey - A `YYYY-MM` month key.
 * @returns The preceding month's `YYYY-MM` key.
 * @throws {RangeError} If `monthKey` is not a valid month key.
 */
export function previousMonth(monthKey: string): string {
  return shiftMonth(monthKey, -1)
}

/**
 * Counts the days in a calendar month, leap years included.
 *
 * @param monthKey - A `YYYY-MM` month key.
 * @returns The number of days, from 28 to 31.
 * @throws {RangeError} If `monthKey` is not a valid month key.
 */
export function daysInMonth(monthKey: string): number {
  const { start, end } = monthPeriod(monthKey)
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000)
}

/**
 * Today's calendar date in a named zone, as `YYYY-MM-DD`.
 *
 * `Intl` rather than offset arithmetic: an offset is a property of an instant,
 * not of a zone, so anything that stores "-05:00" is wrong for half the year in
 * any place that observes daylight saving. An unknown zone falls back to UTC
 * rather than throwing — a bad timezone string on a user row should show the
 * wrong month, not take the page down.
 *
 * @param timezone - An IANA zone name such as `America/New_York`.
 * @param now - The instant to convert; defaults to the current time.
 * @returns The date in `timezone` as `YYYY-MM-DD`, or the UTC date if the zone is unknown.
 */
export function todayIn(timezone: string, now: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now)
    // en-CA formats as YYYY-MM-DD, which is the shape we want without
    // reassembling parts by hand.
    return DATE.test(parts) ? parts : now.toISOString().slice(0, 10)
  } catch {
    return now.toISOString().slice(0, 10)
  }
}

/**
 * How far through a period a given day is, from 0 to 1.
 *
 * Used for pace: 80% of a grocery budget spent is fine on the 28th and a
 * problem on the 10th, and a progress bar that does not know the date cannot
 * tell you which one you are looking at. A past month is 1, a future month 0,
 * so a closed month is judged on its final total rather than on where the
 * clock happens to be.
 *
 * @param monthKey - The `YYYY-MM` month being measured.
 * @param today - The current date as `YYYY-MM-DD`, in the user's zone.
 * @returns A fraction from 0 (not started) to 1 (finished), inclusive of `today` itself.
 * @throws {RangeError} If `monthKey` is not a valid month key.
 */
export function elapsedFraction(monthKey: string, today: string): number {
  const { start, end } = monthPeriod(monthKey)
  if (today < start) return 0
  if (today >= end) return 1
  const day = Number(today.slice(8, 10))
  // Day 1 of a 31-day month is 1/31 elapsed, not 0 — the day itself counts, or
  // every budget looks untouched on the 1st and pace is undefined.
  return day / daysInMonth(monthKey)
}

/** Left-pads a number with zeros to two digits. */
function pad2(n: number): string {
  return String(n).padStart(2, '0')
}
/** Left-pads a number with zeros to four digits. */
function pad4(n: number): string {
  return String(n).padStart(4, '0')
}
