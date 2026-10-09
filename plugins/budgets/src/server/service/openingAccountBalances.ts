import { carryForward } from '../../shared/index.js'
import type { BalanceRepository } from '../repository/BalanceRepository.js'

/**
 * Replays each rolling account line's history to get what it carries into a month.
 *
 * The account counterpart of {@link openingBalances}; the replay itself is the
 * same `carryForward`, so an allowance and a sinking fund cannot disagree about
 * what carrying means.
 *
 * @param balances - Source of the history to replay.
 * @param monthKey - The month whose opening balances are wanted, `YYYY-MM`.
 * @param accountIds - The accounts to replay; typically those with rollover on.
 * @returns Account id to the balance carried into `monthKey`, as a decimal
 *   string. An account whose history does not reach the month is absent.
 */
export async function openingAccountBalances(
  balances: BalanceRepository,
  monthKey: string,
  accountIds: readonly string[],
): Promise<Map<string, string>> {
  const history = await balances.accountHistoryThrough(monthKey, accountIds)
  const out = new Map<string, string>()
  for (const [accountId, entries] of history) {
    const balance = carryForward(entries).find((b) => b.monthKey === monthKey)
    if (balance !== undefined) out.set(accountId, balance.carriedIn)
  }
  return out
}
