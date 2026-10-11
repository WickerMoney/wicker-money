/**
 * A short axis label for a date: "Mar 27". Read in UTC so a date never moves a
 * day with the viewer's zone; the plan's dates are calendar dates, not instants.
 *
 * @param date - `YYYY-MM-DD`.
 */
export function axisMonth(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'short', year: '2-digit', timeZone: 'UTC',
  })
}
