import type { RuleCondition } from './RuleCondition.js'

/**
 * A categorization rule: when every condition matches a transaction, the
 * transaction is filed under `category_id`.
 *
 * Conditions combine with AND only; OR is expressed by writing several rules.
 * A saved rule always has at least one condition.
 */
export interface Rule {
  /** The rule id. */
  readonly id: string
  /** The category a matching transaction is filed under. */
  readonly category_id: string
  /** Higher priority wins when several rules match. */
  readonly priority: number
  /** The tests that must all match. */
  readonly conditions: readonly RuleCondition[]
}
