import type { UpcomingAccount } from '../models/index.js'
import { isZeroAmount } from './isZeroAmount.js'
import { magnitude } from './magnitude.js'

/**
 * One sentence saying which account comes up short, when, and by how much.
 *
 * @param account - A checking account whose headroom is negative.
 * @param formatMoney - The host's money formatter.
 * @param formatDate - The host's date formatter.
 * @returns For example `Monthly Expenses drops to $120.00 on Oct 1, $380.00 below its $500.00 buffer.`
 */
export function shortfallText(
  account: UpcomingAccount,
  formatMoney: (value: string) => string,
  formatDate: (value: string) => string,
): string {
  const below = isZeroAmount(account.buffer) ? 'below zero' : `below its ${formatMoney(account.buffer)} buffer`
  return `${account.name} drops to ${formatMoney(account.lowest.balance)} on ${formatDate(account.lowest.date)}, ` +
    `${formatMoney(magnitude(account.headroom))} ${below}.`
}
