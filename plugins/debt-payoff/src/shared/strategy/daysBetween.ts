/**
 * The number of days from one `YYYY-MM-DD` date to a later one.
 *
 * Calendar arithmetic only (both dates are read as UTC midnights), so daylight
 * saving never adds or removes a day.
 *
 * @param from - The earlier date.
 * @param to - The later date.
 * @returns A whole number of days; negative if `to` is earlier.
 */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / 86_400_000)
}

/** Milliseconds at UTC midnight of a `YYYY-MM-DD` date. */
function toUtcMs(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return Date.UTC(y, m - 1, d)
}
