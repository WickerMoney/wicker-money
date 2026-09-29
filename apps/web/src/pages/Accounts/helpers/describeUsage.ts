import type { AccountUsage } from '../../../models/index.js'

/** Maps a referencing table name to the noun shown to the user. */
const FRIENDLY: Record<string, string> = {
  'core.transactions': 'transaction',
  'core.recurring_items': 'recurring item',
  // Recurring items reach accounts through their legs, one per account per
  // item, so a count of legs is a count of items.
  'core.recurring_item_legs': 'recurring item',
}

/**
 * Summarizes what references an account in plain words.
 *
 * @param usage - The usage breakdown returned by the API.
 * @returns For example `"42 transactions and 3 recurring items"`.
 */
export function describeUsage(usage: AccountUsage): string {
  const parts = usage.by.map(({ table, count }) => {
    const noun = FRIENDLY[table] ?? table
    return `${count} ${noun}${count === 1 ? '' : 's'}`
  })
  if (parts.length === 0) return 'something this connection cannot see'
  if (parts.length === 1) return parts[0] as string
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}
