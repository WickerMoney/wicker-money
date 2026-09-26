/**
 * Whether a `YYYY-MM-DD` string names a day that exists.
 *
 * The date is rebuilt from its parts and compared back, so `2026-02-31` (which
 * `Date` would silently roll into March) and month `13` are rejected. Year zero
 * is refused because PostgreSQL has no such year.
 *
 * @param value - A string already known to match `YYYY-MM-DD`.
 * @returns True if the year, month and day form a real calendar date.
 */
export function isRealCalendarDate(value: string): boolean {
  const [year, month, day] = value.split('-').map(Number)
  if (year === undefined || month === undefined || day === undefined || year < 1) return false
  // setUTCFullYear rather than Date.UTC, which treats years 0-99 as 1900-1999.
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}
