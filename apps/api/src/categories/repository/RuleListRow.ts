/** A `core.category_rules` row as returned by the rule listing query. */
export interface RuleListRow {
  id: string
  user_id: string
  category_id: string
  priority: number
  created_at: Date
  updated_at: Date
}
