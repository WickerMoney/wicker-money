import type { MatchCondition } from '../engine.js'
import type { ConditionInput } from './ConditionInput.js'

/**
 * Maps one condition into the column shape shared by the
 * `category_rule_conditions` table and the matching engine.
 *
 * @param c - A validated condition.
 * @returns The condition with every matchable column present (unused ones `null`).
 */
export function toConditionColumns(c: ConditionInput): MatchCondition {
  switch (c.conditionType) {
    case 'merchant_exact':
    case 'merchant_contains':
    case 'description_contains':
      return {
        condition_type: c.conditionType,
        text_value: c.textValue,
        is_case_sensitive: c.isCaseSensitive,
        direction: null,
        amount_value: null,
        amount_min: null,
        amount_max: null,
      }
    case 'amount_exact':
      return {
        condition_type: c.conditionType,
        text_value: null,
        is_case_sensitive: false,
        direction: c.direction,
        amount_value: c.amountValue,
        amount_min: null,
        amount_max: null,
      }
    case 'amount_range':
      return {
        condition_type: c.conditionType,
        text_value: null,
        is_case_sensitive: false,
        direction: c.direction,
        amount_value: null,
        amount_min: c.amountMin ?? null,
        amount_max: c.amountMax ?? null,
      }
  }
}
