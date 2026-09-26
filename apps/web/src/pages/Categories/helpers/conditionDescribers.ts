import type { ConditionType, RuleCondition } from '../../../models/index.js'
import { caseSuffix } from './caseSuffix.js'
import { describeAmountRange } from './describeAmountRange.js'
import { directionWord } from './directionWord.js'

/**
 * One plain-words describer per condition type.
 *
 * A record keyed by the union makes a new condition type a compile error here
 * until it has a description, instead of a silent `undefined` at runtime.
 */
export const CONDITION_DESCRIBERS: Readonly<Record<ConditionType, (c: RuleCondition) => string>> = {
  merchant_exact: (c) => `Merchant is exactly '${c.text_value ?? ''}'${caseSuffix(c)}`,
  merchant_contains: (c) => `Merchant contains '${c.text_value ?? ''}'${caseSuffix(c)}`,
  description_contains: (c) => `Notes contain '${c.text_value ?? ''}'${caseSuffix(c)}`,
  amount_exact: (c) => `Amount ${directionWord(c)} exactly ${c.amount_value ?? ''}`,
  amount_range: describeAmountRange,
}
