import { compareMoney, ZERO_MONEY } from '@wickermoney/plugin-sdk/money'
import { UNKNOWN_CATEGORY } from './UNKNOWN_CATEGORY.js'
import type { UnbudgetedSpend } from './UnbudgetedSpend.js'

/**
 * Lists the categories with spending and no plan, biggest first.
 *
 * A category that was forgotten looks identical to one with no spending,
 * because neither appears on the page, so surfacing them is the most useful
 * thing a budget can add.
 *
 * Only positive net spend counts. A category whose month nets negative is
 * income or a refund, and "you have not budgeted for your salary" is not a
 * useful sentence.
 *
 * @param spend - Category id to net spend for the month, as decimal strings.
 * @param budgeted - Category ids that have a line this month.
 * @param nameOf - Resolves a category id to its display name.
 * @returns The unbudgeted categories ordered by descending spend.
 */
export function findUnbudgeted(
  spend: ReadonlyMap<string, string>,
  budgeted: ReadonlySet<string>,
  nameOf: (categoryId: string) => string = () => UNKNOWN_CATEGORY,
): UnbudgetedSpend[] {
  return [...spend.entries()]
    .filter(([categoryId, amount]) => !budgeted.has(categoryId) && compareMoney(amount, ZERO_MONEY) > 0)
    .map(([categoryId, spent]) => ({ categoryId, categoryName: nameOf(categoryId), spent }))
    .sort((a, b) => compareMoney(b.spent, a.spent))
}
