import type { ForecastEntry } from '../models/index.js'

/**
 * The other side of an entry, in words, from the forecast account's point of
 * view: "to Savings" or "from Checking" for a transfer or debt payment, and
 * the other accounts of a split paycheck ("also to Savings"). Empty for a
 * bill or a single-account paycheck.
 *
 * @param entry - The entry.
 * @param accountId - The account being forecast.
 * @param accountName - Looks up an account's name.
 * @returns The description, or an empty string.
 */
export function counterpart(entry: ForecastEntry, accountId: string, accountName: (id: string) => string): string {
  const others = entry.legs.filter((l) => l.accountId !== accountId)
  if (others.length === 0) return ''
  const names = others.map((l) => accountName(l.accountId)).join(', ')
  if (entry.kind === 'income') return `also to ${names}`
  return entry.amount.startsWith('-') ? `to ${names}` : `from ${names}`
}
