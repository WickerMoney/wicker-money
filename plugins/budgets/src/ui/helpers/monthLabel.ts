const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/**
 * Formats a month key for display.
 *
 * @param monthKey - A month as `YYYY-MM`.
 * @returns For example `"March 2026"`.
 */
export function monthLabel(monthKey: string): string {
  const month = Number(monthKey.slice(5, 7))
  return `${MONTH_NAMES[month - 1] ?? monthKey} ${monthKey.slice(0, 4)}`
}
