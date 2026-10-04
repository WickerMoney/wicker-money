/** A user-owned core table included in the data export. */
export type ExportTable =
  | 'accounts'
  | 'categories'
  | 'category_rules'
  | 'category_rule_conditions'
  | 'transactions'
  | 'transaction_splits'
  | 'recurring_items'
  | 'recurring_item_legs'
  | 'recurring_occurrences'
  | 'recurring_occurrence_legs'
  | 'recurring_match_dismissals'
