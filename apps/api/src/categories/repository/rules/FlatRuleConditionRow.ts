import type { AmountDirection, RuleConditionType } from '../../../db/models/index.js'

/** One row of the resolution query: a rule's category joined to one of its conditions, before grouping by rule. */
export interface FlatRuleConditionRow {
  /** Owning rule id; rows sharing it are grouped into one match rule. */
  readonly rule_id: string
  /** Category the rule assigns. */
  readonly category_id: string
  /** Kind of condition this row holds. */
  readonly condition_type: RuleConditionType
  /** Text to match, for text condition types. */
  readonly text_value: string | null
  /** Whether text comparison is case-sensitive. */
  readonly is_case_sensitive: boolean
  /** Money direction, for amount condition types. */
  readonly direction: AmountDirection | null
  /** Positive magnitude for `amount_exact`, as a decimal string. */
  readonly amount_value: string | null
  /** Inclusive lower magnitude bound for `amount_range`, as a decimal string. */
  readonly amount_min: string | null
  /** Inclusive upper magnitude bound for `amount_range`, as a decimal string. */
  readonly amount_max: string | null
}
