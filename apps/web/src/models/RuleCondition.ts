import type { ConditionType } from './ConditionType.js'

/**
 * One saved test within a categorization rule.
 *
 * Only the fields relevant to `condition_type` are populated; the rest are `null`.
 */
export interface RuleCondition {
  /** The condition id. */
  readonly id: string
  /** Which test this condition applies. */
  readonly condition_type: ConditionType
  /** Text to match, for the merchant and description condition types. */
  readonly text_value: string | null
  /** Whether text matching respects letter case. */
  readonly is_case_sensitive: boolean
  /** Which side of zero an amount condition applies to. */
  readonly direction: 'in' | 'out' | null
  /** Exact amount to match, as a decimal string; only for exact-amount conditions. */
  readonly amount_value: string | null
  /** Lower bound of an amount range, as a decimal string; only for range conditions. */
  readonly amount_min: string | null
  /** Upper bound of an amount range, as a decimal string; only for range conditions. */
  readonly amount_max: string | null
}
