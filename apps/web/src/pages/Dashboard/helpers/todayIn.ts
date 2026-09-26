import { localIsoDate } from '../../../lib/localIsoDate.js'

/**
 * Returns today's date in a named time zone.
 *
 * @param timezone - An IANA zone name such as `America/New_York`.
 * @returns An ISO date, `YYYY-MM-DD`. Falls back to today in the local time
 *   zone when the zone name is not recognized.
 */
export function todayIn(timezone: string): string {
  try {
    // The en-CA locale formats as YYYY-MM-DD, which avoids reassembling the
    // parts by hand.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date())
  } catch {
    return localIsoDate()
  }
}
