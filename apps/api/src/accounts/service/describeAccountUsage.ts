import type { ReferenceUsage } from '../../db/usage.js'

/** Singular display nouns for tables known to reference accounts. */
const FRIENDLY: Record<string, string> = {
  'core.transactions': 'transaction',
  'core.recurring_items': 'recurring item',
}

/**
 * Renders a usage summary as a readable phrase, such as
 * `"3 transactions and 1 recurring item"`.
 *
 * Tables without a known display noun are named as-is, with a plural `s`
 * added when the count is not one.
 *
 * @param usage - The usage counts to describe.
 * @returns A human-readable list of what is referencing the account.
 */
export function describeAccountUsage(usage: ReferenceUsage): string {
  const parts = usage.by.map(({ table, count }) => {
    const noun = FRIENDLY[table] ?? table
    return `${count} ${noun}${count === 1 ? '' : 's'}`
  })
  if (parts.length === 0) return 'something this connection cannot see'
  if (parts.length === 1) return parts[0] as string
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}
