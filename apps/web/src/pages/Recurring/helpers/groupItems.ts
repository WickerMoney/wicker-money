import type { RecurringItem } from '../../../models/index.js'

/** The list's three sections. */
export interface GroupedItems {
  readonly income: readonly RecurringItem[]
  /** Bills and debt payments: money leaving the household. */
  readonly outgoing: readonly RecurringItem[]
  /** Moves between the user's own accounts: neither income nor spending. */
  readonly transfers: readonly RecurringItem[]
}

/**
 * Splits items into income, outgoing and transfers, keeping the server's order
 * (next due first) within each.
 *
 * @param items - Items as listed.
 * @returns The three groups.
 */
export function groupItems(items: readonly RecurringItem[]): GroupedItems {
  return {
    income: items.filter((i) => i.kind === 'income'),
    outgoing: items.filter((i) => i.kind === 'bill' || i.kind === 'debt_payment'),
    transfers: items.filter((i) => i.kind === 'transfer'),
  }
}
