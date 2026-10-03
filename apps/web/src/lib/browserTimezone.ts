/**
 * The browser's own IANA time zone, such as `America/New_York`.
 *
 * @returns The zone, or `undefined` if the browser does not report one.
 */
export function browserTimezone(): string | undefined {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    return typeof zone === 'string' && zone.length > 0 ? zone : undefined
  } catch {
    return undefined
  }
}
