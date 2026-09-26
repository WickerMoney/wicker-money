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
