import type { Generated, Insertable, Selectable } from 'kysely'
import type { Money, TimestampWithDefault } from './columns.js'
import type { AmountDirection } from './AmountDirection.js'
import type { RuleConditionType } from './RuleConditionType.js'

/**
 * One AND-ed condition of a rule. A rule matches a transaction when every one
 * of its conditions does. The text fields and the amount fields are mutually
 * exclusive per `condition_type`, enforced by the database check constraint
 * `ck_category_rule_conditions_shape`: exactly one of the two shapes is ever
 * populated for a given row.
 */
export interface CategoryRuleConditionsTable {
  id: Generated<string>
  user_id: string
  rule_id: string
  condition_type: RuleConditionType
  /** `merchant_exact`, `merchant_contains` and `description_contains` only. */
  text_value: string | null
  is_case_sensitive: Generated<boolean>
  /** `amount_exact` and `amount_range` only. A magnitude plus a direction, never a signed amount. */
  direction: AmountDirection | null
  amount_value: Money | null
  amount_min: Money | null
  amount_max: Money | null
  created_at: TimestampWithDefault
}

export type CategoryRuleCondition = Selectable<CategoryRuleConditionsTable>

export type NewCategoryRuleCondition = Insertable<CategoryRuleConditionsTable>
