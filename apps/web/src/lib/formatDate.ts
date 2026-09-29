const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * Formats a date for display in the browser's locale.
 *
 * A calendar date (`YYYY-MM-DD`) is shown as that day, whatever the browser's
 * time zone. `new Date('2026-10-01')` is midnight UTC, which is still
 * September 30th anywhere west of Greenwich, so formatting it directly shows
 * the day before — a due date one day early, in a finance app. Calendar dates
 * are therefore built from their parts in local time; anything else (an
 * instant with a time) is formatted as given.
 *
 * @param value - `YYYY-MM-DD`, or any string `Date` accepts.
 * @returns The locale's short date, e.g. `10/1/2026`.
 */
export function formatDate(value: string): string {
  const match = CALENDAR_DATE.exec(value)
  if (match === null) return new Date(value).toLocaleDateString()
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).toLocaleDateString()
}
