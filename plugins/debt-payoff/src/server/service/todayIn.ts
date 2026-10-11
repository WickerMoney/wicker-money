const DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * The calendar date in a time zone, as `YYYY-MM-DD`.
 *
 * The plan's start date is "today" for the person, and the plugin cannot read
 * their saved time zone (that lives on the user row, which no plugin is
 * granted), so the page sends its own. An unknown zone falls back to UTC, the
 * same fallback Budgets uses; routes validate the zone first, so the fallback
 * is only a guard.
 *
 * @param timezone - An IANA zone such as `America/New_York`.
 * @param now - The instant to convert.
 * @returns The date there.
 */
export function todayIn(timezone: string, now: Date): string {
  try {
    const formatted = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(now)
    return DATE.test(formatted) ? formatted : now.toISOString().slice(0, 10)
  } catch {
    return now.toISOString().slice(0, 10)
  }
}
