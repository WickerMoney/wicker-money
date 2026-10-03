/**
 * Adds whole calendar months to a date, clamping to the last day of a
 * shorter month (Aug 31 + 6 months is Feb 28, or Feb 29 in a leap year).
 *
 * @param date - `YYYY-MM-DD`.
 * @param months - Months to add; may be negative.
 * @returns The resulting date, `YYYY-MM-DD`.
 */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const target = new Date(Date.UTC(y, m - 1 + months, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(d, lastDay))
  return target.toISOString().slice(0, 10)
}
