/**
 * Adds whole days to a calendar date.
 *
 * Arithmetic on a UTC midnight, never local time, so no DST change can move
 * the result a day.
 *
 * @param date - `YYYY-MM-DD`.
 * @param days - Days to add; may be negative.
 * @returns The resulting date, `YYYY-MM-DD`.
 */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}
