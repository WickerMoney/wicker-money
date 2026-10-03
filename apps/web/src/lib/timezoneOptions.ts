/**
 * The IANA time zones to offer in a picker, sorted, with `UTC` first.
 *
 * Comes from the browser's own list. `current` is always included, so an
 * account set to a zone this browser does not list (an alias, or a zone added
 * in a newer tz release) still shows what it is set to rather than a blank.
 *
 * @param current - The zone the account is set to now.
 * @returns Zone names, `UTC` first and the rest alphabetical.
 */
export function timezoneOptions(current?: string): string[] {
  const set = new Set(supportedZones())
  set.delete('UTC')
  if (current !== undefined && current !== 'UTC') set.add(current)
  return ['UTC', ...[...set].sort((a, b) => a.localeCompare(b))]
}

/** The browser's IANA zone list, or none on a browser too old to report it. */
function supportedZones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone')
  } catch {
    return []
  }
}
