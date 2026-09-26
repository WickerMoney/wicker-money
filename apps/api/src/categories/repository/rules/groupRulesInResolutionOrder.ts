import type { MatchCondition, MatchRule } from '../../engine.js'
import type { FlatRuleConditionRow } from './FlatRuleConditionRow.js'

/**
 * Groups flat rule/condition rows into match rules, preserving the order the
 * rows arrived in (the SQL's ORDER BY decides rule order; this only groups).
 *
 * A pure function, separate from the query so it can be unit tested without a
 * database.
 *
 * @param rows - Flat rows already sorted in resolution order.
 * @returns One {@link MatchRule} per distinct `rule_id`, in first-seen order.
 */
export function groupRulesInResolutionOrder(rows: readonly FlatRuleConditionRow[]): MatchRule[] {
  const order: string[] = []
  const byRuleId = new Map<string, { category_id: string; conditions: MatchCondition[] }>()

  for (const row of rows) {
    let entry = byRuleId.get(row.rule_id)
    if (entry === undefined) {
      entry = { category_id: row.category_id, conditions: [] }
      byRuleId.set(row.rule_id, entry)
      order.push(row.rule_id)
    }
    entry.conditions.push({
      condition_type: row.condition_type,
      text_value: row.text_value,
      is_case_sensitive: row.is_case_sensitive,
      direction: row.direction,
      amount_value: row.amount_value,
      amount_min: row.amount_min,
      amount_max: row.amount_max,
    })
  }

  return order.map((id) => byRuleId.get(id) as { category_id: string; conditions: MatchCondition[] })
}
