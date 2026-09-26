import type { MatchRule } from '../../engine.js'
import type { FlatRuleConditionRow } from './FlatRuleConditionRow.js'
import { groupRulesInResolutionOrder } from './groupRulesInResolutionOrder.js'
import type { RuleRowRunner } from './RuleRowRunner.js'

/**
 * The single implementation of rule resolution order, as SQL.
 *
 * Takes a *runner* rather than a database handle so the same query text and row
 * shape serve every caller, including code that reads rules under its own
 * scoped database role (the plugin host hands bundled plugins this function).
 * Changing the ORDER BY here changes it everywhere: `priority DESC`, then
 * number of conditions `DESC`, then `created_at ASC` (with rule and condition
 * ids as deterministic final tiebreaks). Rules without any condition rows do
 * not appear.
 *
 * @param run - Query runner for the connection whose rules should be read.
 * @returns Rules in resolution order, ready for `resolveCategory`.
 */
export async function fetchRulesInResolutionOrder(run: RuleRowRunner): Promise<MatchRule[]> {
  const rows = await run<FlatRuleConditionRow>`
    SELECT r.id AS rule_id, r.category_id,
           c.condition_type::text AS condition_type, c.text_value, c.is_case_sensitive,
           c.direction::text AS direction, c.amount_value::text AS amount_value,
           c.amount_min::text AS amount_min, c.amount_max::text AS amount_max
    FROM core.category_rules r
    JOIN core.category_rule_conditions c ON c.rule_id = r.id
    ORDER BY r.priority DESC,
             (SELECT count(*) FROM core.category_rule_conditions cc WHERE cc.rule_id = r.id) DESC,
             r.created_at ASC, r.id, c.id
  `
  return groupRulesInResolutionOrder(rows)
}
