import type { RecurringItem } from '../../../models/index.js'

/** What moving an account's history does to one recurring item. */
export type RecurringFate = 'moved' | 'combined' | 'removed'

/**
 * Mirrors what the server's merge does with each recurring item, so the panel
 * can say it before the user commits:
 *
 * - a transfer or debt payment between the two accounts would become a
 *   transfer from an account to itself, so it is **removed**;
 * - income paid into both accounts keeps paying the same total, with its two
 *   parts **combined** into the target;
 * - anything else is **moved** to the target.
 *
 * The counts come from the server's preview; this only names the items.
 *
 * @param item - A recurring item with a leg on the source account.
 * @param toId - The account the history moves into.
 * @returns The item's fate.
 */
export function recurringFate(item: RecurringItem, toId: string): RecurringFate {
  const touchesTarget = item.legs.some((l) => l.accountId === toId)
  if (!touchesTarget) return 'moved'
  return item.kind === 'transfer' || item.kind === 'debt_payment' ? 'removed' : 'combined'
}
