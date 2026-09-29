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
  // Also grants `recurring_item_legs`: an item is its schedule plus its legs,
  // and neither is usable without the other.
  'recurring_items',
] as const
