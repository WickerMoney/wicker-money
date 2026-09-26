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
  'recurring_items',
] as const
