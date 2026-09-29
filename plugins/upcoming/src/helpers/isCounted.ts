import type { UpcomingAccount } from '../models/index.js'

/**
 * Whether an account counts toward safe to spend. A server from before the
 * setting sends no flag and counted every account it listed.
 *
 * @param account - One account from the outlook.
 * @returns True unless the server says it is not counted.
 */
export function isCounted(account: UpcomingAccount): boolean {
  return account.counted !== false
}
