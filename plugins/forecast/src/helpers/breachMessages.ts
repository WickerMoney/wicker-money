import type { ForecastAccount, ForecastStats } from '../models/index.js'

/**
 * The sentences for the first-breach banner, worst news first, or none when
 * the account stays clear.
 *
 * A buffer breach is mentioned only when it comes before going below zero:
 * on the same day, overdrawn is the whole story. Cards and loans have no
 * banner, because a negative balance there is simply what is owed.
 *
 * @param account - The account forecast.
 * @param stats - Its stats.
 * @param today - The user's today.
 * @param money - Formats an amount.
 * @param date - Formats a date.
 * @returns Zero, one or two sentences.
 */
export function breachMessages(
  account: ForecastAccount,
  stats: ForecastStats,
  today: string,
  money: (v: string) => string,
  date: (v: string) => string,
): string[] {
  if (!account.cash) return []
  const out: string[] = []
  const zero = stats.firstBelowZero
  const buffer = stats.firstBelowBuffer
  if (buffer !== null && (zero === null || buffer.date < zero.date)) {
    out.push(buffer.date === today
      ? `${account.name} is already below its ${money(account.buffer)} buffer, at ${money(buffer.balance)}.`
      : `${account.name} drops below its ${money(account.buffer)} buffer on ${date(buffer.date)}, to ${money(buffer.balance)}.`)
  }
  if (zero !== null) {
    out.push(zero.date === today
      ? `${account.name} is already overdrawn, at ${money(zero.balance)}.`
      : `${account.name} goes below zero on ${date(zero.date)}, to ${money(zero.balance)}.`)
  }
  if (out.length > 0 && stats.lowest.date !== (zero ?? buffer)?.date) {
    out.push(`Its lowest point is ${money(stats.lowest.balance)} on ${date(stats.lowest.date)}.`)
  }
  return out
}
