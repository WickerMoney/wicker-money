import type { CategoryUsage } from './CategoryUsage.js'

/** Singular display nouns for tables known to reference categories. */
const FRIENDLY: Record<string, string> = {
  'core.transactions': 'transaction',
  'core.transaction_splits': 'split',
  'core.category_rules': 'rule',
  'core.recurring_items': 'recurring item',
  'plugin_budgets.budget_lines': 'budget line',
}

/**
 * Renders a usage summary as a readable phrase, such as
 * `"3 transactions, 1 rule and 2 child categories"`.
 *
 * Tables without a known display noun are named as-is and not pluralised.
 *
 * @param usage - The usage counts to describe.
 * @returns A human-readable list of what is referencing the category.
 */
export function describeUsage(usage: CategoryUsage): string {
  const parts = usage.by.map(({ table, count }) => {
    const noun = FRIENDLY[table] ?? table
    return `${count} ${noun}${count === 1 || FRIENDLY[table] === undefined ? '' : 's'}`
  })
  if (usage.childCount > 0) {
    parts.push(`${usage.childCount} child ${usage.childCount === 1 ? 'category' : 'categories'}`)
  }
  if (parts.length === 0) return 'something this connection cannot see'
  if (parts.length === 1) return parts[0] as string
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}
