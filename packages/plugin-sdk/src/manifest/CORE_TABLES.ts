/**
 * Names of the core tables a plugin may request access to.
 *
 * A plugin lists the tables it needs in its manifest's `requiredTables`; any
 * table not named here cannot be granted.
 */
export const CORE_TABLES = [
  'accounts',
  'transactions',
  'transaction_splits',
  'categories',
  'category_rules',
  'category_rule_conditions',
  // Also grants `recurring_item_legs`, `recurring_occurrences` and
  // `recurring_occurrence_legs`: an item is its schedule plus its legs plus
  // what was recorded about single occurrences, and none is usable alone.
  'recurring_items',
] as const
