/**
 * Formats a month as a short axis label.
 *
 * @param month - A month as `YYYY-MM`.
 * @returns The locale's short month name, for example `"Mar"`.
 */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-')
  const date = new Date(Number(y), Number(m) - 1, 1)
  return date.toLocaleDateString(undefined, { month: 'short' })
}

/**
 * Formats a month with its year, for tooltips where the year matters and space allows.
 *
 * @param month - A month as `YYYY-MM`.
 * @returns For example `"Mar 2026"`.
 */
export function monthLabelLong(month: string): string {
  const [y, m] = month.split('-')
  const date = new Date(Number(y), Number(m) - 1, 1)
  return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}
