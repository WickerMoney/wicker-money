import { carryForward } from '../../shared/index.js'
import type { BalanceRepository } from '../repository/BalanceRepository.js'

/**
 * Replays each rolling category's history to get what it carries into a month.
 *
 * @param balances - Source of the history to replay.
 * @param monthKey - The month whose opening balances are wanted, `YYYY-MM`.
 * @param categoryIds - The categories to replay; typically those with rollover on.
 * @param currentSpend - Category id to net spend in `monthKey`, already read by the caller.
 * @returns Category id to the balance carried into `monthKey`, as a decimal
 *   string. A category whose history does not reach the month is absent.
 */
export async function openingBalances(
  balances: BalanceRepository,
  monthKey: string,
  categoryIds: readonly string[],
  currentSpend: ReadonlyMap<string, string>,
): Promise<Map<string, string>> {
  const history = await balances.historyThrough(monthKey, categoryIds, currentSpend)
  const out = new Map<string, string>()
  for (const [categoryId, entries] of history) {
    const balance = carryForward(entries).find((b) => b.monthKey === monthKey)
    if (balance !== undefined) out.set(categoryId, balance.carriedIn)
  }
  return out
}
