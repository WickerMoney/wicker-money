/**
 * Formats a date as `YYYY-MM-DD` using the local calendar day.
 *
 * `toISOString()` reports the UTC day, which is tomorrow's date for anyone west
 * of Greenwich in the evening (and yesterday's for anyone east of it just after
 * midnight). A date the user is meant to read as "today" must come from the
 * local getters instead.
 *
 * @param date - The instant to format. Defaults to now.
 * @returns The local date as `YYYY-MM-DD`.
 */
export function localIsoDate(date: Date = new Date()): string {
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
