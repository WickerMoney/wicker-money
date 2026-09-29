/**
 * @module
 * Calendar-date arithmetic on `YYYY-MM-DD` strings. Internal to the SDK.
 *
 * Dates here are calendar days, not instants: there is no time of day and no
 * time zone, so nothing can shift a day across midnight or a DST change. The
 * day number is a count of days since 1970-01-01 computed with `Date.UTC`,
 * which is only ever used as an integer calendar and never read back in local
 * time.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const MS_PER_DAY = 86_400_000

/**
 * Parses a `YYYY-MM-DD` string into its parts, rejecting impossible dates.
 *
 * `Date.UTC(2026, 1, 30)` silently rolls over to March 2nd, so the parts are
 * checked against the month's real length rather than trusted.
 *
 * @param value - The date string.
 * @param label - What the value is, for the error message.
 * @returns Year, month (1-12) and day.
 * @throws {RangeError} If `value` is not a real calendar date in `YYYY-MM-DD` form.
 */
export function parseDate(value: string, label = 'date'): { year: number; month: number; day: number } {
  const match = ISO_DATE.exec(value)
  if (!match) throw new RangeError(`Invalid ${label}: ${JSON.stringify(value)} (expected YYYY-MM-DD)`)
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new RangeError(`Invalid ${label}: ${JSON.stringify(value)} is not a calendar date`)
  }
  return { year, month, day }
}

/**
 * Converts a `YYYY-MM-DD` string to a day number (days since 1970-01-01).
 *
 * @param value - The date string.
 * @param label - What the value is, for the error message.
 * @returns The day number.
 * @throws {RangeError} If `value` is not a valid date.
 */
export function toDayNumber(value: string, label = 'date'): number {
  const { year, month, day } = parseDate(value, label)
  return Date.UTC(year, month - 1, day) / MS_PER_DAY
}

/**
 * Converts a day number back to `YYYY-MM-DD`.
 *
 * @param dayNumber - Days since 1970-01-01.
 * @returns The date string.
 */
export function fromDayNumber(dayNumber: number): string {
  const d = new Date(dayNumber * MS_PER_DAY)
  return formatDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
}

/**
 * Formats date parts as `YYYY-MM-DD`.
 *
 * @param year - Four-digit year.
 * @param month - Month, 1-12.
 * @param day - Day of month.
 * @returns The date string.
 */
export function formatDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * The number of days in a month, accounting for leap years.
 *
 * @param year - Four-digit year.
 * @param month - Month, 1-12.
 * @returns 28 to 31.
 */
export function daysInMonth(year: number, month: number): number {
  // Day 0 of the following month is the last day of this one.
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/**
 * The date `months` whole months after a year and month, on `day` clamped to
 * that month's last day.
 *
 * @param year - Starting year.
 * @param month - Starting month, 1-12.
 * @param months - Whole months to add; may be zero.
 * @param day - The wanted day of month, 1-31.
 * @returns The clamped date as `YYYY-MM-DD`.
 */
export function clampedMonthDate(year: number, month: number, months: number, day: number): string {
  const absolute = year * 12 + (month - 1) + months
  const y = Math.floor(absolute / 12)
  const m = (absolute % 12) + 1
  return formatDate(y, m, Math.min(day, daysInMonth(y, m)))
}

/**
 * Whole months from one year/month to another (`to - from`), ignoring days.
 *
 * @param fromYear - Year of the earlier month.
 * @param fromMonth - Earlier month, 1-12.
 * @param toYear - Year of the later month.
 * @param toMonth - Later month, 1-12.
 * @returns The month difference; negative when `to` is earlier.
 */
export function monthsBetween(fromYear: number, fromMonth: number, toYear: number, toMonth: number): number {
  return (toYear * 12 + toMonth) - (fromYear * 12 + fromMonth)
}
