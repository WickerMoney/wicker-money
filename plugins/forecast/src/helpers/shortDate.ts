const FORMAT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
const MONTH = new Intl.DateTimeFormat(undefined, { month: 'short', timeZone: 'UTC' })

/**
 * A compact axis label for a calendar date: "Oct 15", or just "Nov" on the
 * first of a month in a long chart.
 *
 * The date is read and formatted in UTC on purpose. It is a calendar date
 * with no time, and reading it as local midnight shows the previous day west
 * of UTC (the bug the host's `formatDate` was fixed for).
 *
 * @param date - `YYYY-MM-DD`.
 * @param monthOnly - Name only the month.
 * @returns The label.
 */
export function shortDate(date: string, monthOnly = false): string {
  const at = new Date(`${date}T00:00:00Z`)
  return (monthOnly ? MONTH : FORMAT).format(at)
}
