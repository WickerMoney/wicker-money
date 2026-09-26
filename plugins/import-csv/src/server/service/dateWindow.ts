/**
 * Computes the date range to load existing transactions for.
 *
 * The range spans the earliest to the latest date in the file, widened by two
 * days each side so a heuristic duplicate match just outside the file's own
 * range is still found.
 *
 * @param dates - ISO `YYYY-MM-DD` dates, in any order.
 * @returns Inclusive ISO `from` and `to` bounds, or `null` when there are no dates.
 */
export function dateWindow(dates: readonly string[]): { from: string; to: string } | null {
  if (dates.length === 0) return null
  const sorted = [...dates].sort()
  const shift = (iso: string, days: number): string => {
    const d = new Date(`${iso}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + days)
    return d.toISOString().slice(0, 10)
  }
  return { from: shift(sorted[0]!, -2), to: shift(sorted[sorted.length - 1]!, 2) }
}
