/**
 * The first day of the month a number of months before the month of a date.
 *
 * @param date - A calendar date as `YYYY-MM-DD`.
 * @param monthsBack - Whole months to step back; `0` gives the date's own month.
 * @returns The first of that month as `YYYY-MM-DD`.
 */
export function firstOfMonthBefore(date: string, monthsBack: number): string {
  const year = Number(date.slice(0, 4))
  const month = Number(date.slice(5, 7))
  const index = year * 12 + (month - 1) - monthsBack
  const y = Math.floor(index / 12)
  const m = (index % 12) + 1
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-01`
}
