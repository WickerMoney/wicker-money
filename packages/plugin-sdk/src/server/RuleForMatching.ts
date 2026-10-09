import type { ConditionForMatching } from './ConditionForMatching.js'

/**
 * One category rule as the host's rule engine consumes it.
 *
 * Field names are snake_case to match the host's row shape rather than the
 * SDK's usual camelCase. A plugin does not normally read these fields: a value
 * flows unchanged from the host's `getRulesForMatching` into its
 * `resolveCategory`, so the type only describes what arrives at runtime.
 */
export interface RuleForMatching {
  /** The category assigned when every condition matches. */
  readonly category_id: string
  /** Conditions that must all match for the rule to apply. */
  readonly conditions: readonly ConditionForMatching[]
}
