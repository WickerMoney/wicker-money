/**
 * The calendar date at an instant in a given time zone.
 *
 * @param timezone - An IANA zone name such as `Europe/London`. An unknown name falls back to UTC.
 * @param now - The instant.
 * @returns The date as `YYYY-MM-DD`.
 */
export function todayIn(timezone: string, now: Date): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now)
    const part = (type: string): string => parts.find((p) => p.type === type)?.value ?? ''
    return `${part('year')}-${part('month')}-${part('day')}`
  } catch {
    return now.toISOString().slice(0, 10)
  }
}
