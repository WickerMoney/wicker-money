/** An IANA zone name: letters first, then `/`-separated parts. Rules out `+01:00`-style offsets. */
const IANA_NAME = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/

/**
 * The canonical spelling of an IANA time zone name, or `undefined` if the
 * runtime does not know it.
 *
 * Matching is case-insensitive and follows the runtime's aliases, so
 * `us/eastern` comes back as `America/New_York` and `utc` as `UTC`. Fixed
 * offsets such as `+01:00` are refused even though `Intl` accepts them: they
 * have no daylight saving and PostgreSQL reads their sign the other way round,
 * so storing one would be a trap for whatever reads `users.timezone` next.
 *
 * @param name - A candidate zone name, such as the browser's
 *   `Intl.DateTimeFormat().resolvedOptions().timeZone`.
 * @returns The canonical name, or `undefined` if it is not a known IANA zone.
 */
export function canonicalTimezone(name: string): string | undefined {
  const trimmed = name.trim()
  if (trimmed.length === 0 || trimmed.length > 64 || !IANA_NAME.test(trimmed)) return undefined
  let resolved: string
  try {
    resolved = new Intl.DateTimeFormat('en-US', { timeZone: trimmed }).resolvedOptions().timeZone
  } catch {
    return undefined
  }
  return IANA_NAME.test(resolved) ? resolved : undefined
}
