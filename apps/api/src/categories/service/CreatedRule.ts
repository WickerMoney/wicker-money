import type { CategoryRule, CategoryRuleCondition } from '../../db/models/index.js'

/** Result of creating a rule. */
export interface CreatedRule {
  readonly rule: CategoryRule & { conditions: CategoryRuleCondition[] }
  /** Number of transactions the rule was applied to on creation. */
  readonly recategorized: number
}
