import type { ExportTable } from '../repository/ExportTable.js'

/** The core tables of an export, in document order: the JSON key each is written under and its table. */
export const EXPORT_SECTIONS: readonly { readonly key: string; readonly table: ExportTable }[] = [
  { key: 'accounts', table: 'accounts' },
  { key: 'categories', table: 'categories' },
  { key: 'categoryRules', table: 'category_rules' },
  { key: 'categoryRuleConditions', table: 'category_rule_conditions' },
  { key: 'transactions', table: 'transactions' },
  { key: 'transactionSplits', table: 'transaction_splits' },
  { key: 'recurringItems', table: 'recurring_items' },
  { key: 'recurringItemLegs', table: 'recurring_item_legs' },
  { key: 'recurringOccurrences', table: 'recurring_occurrences' },
  { key: 'recurringOccurrenceLegs', table: 'recurring_occurrence_legs' },
]
