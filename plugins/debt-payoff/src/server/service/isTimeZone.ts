/**
 * Tests whether a string names a time zone this runtime knows.
 *
 * @param value - Candidate IANA zone name.
 * @returns `true` if `Intl` accepts it.
 */
export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: value })
    return true
  } catch {
    return false
  }
}
