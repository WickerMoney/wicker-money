import type { ConditionForMatching } from './ConditionForMatching.js'

/**
 * One category rule as the host's rule engine consumes it.
 *
 * Field names are snake_case to match the host's row shape rather than this
 * package's usual camelCase. The plugin never reads these fields: a value flows
 * unchanged from `getRulesForMatching` into `resolveCategory`, both supplied by
 * the host, so the type only describes what arrives at runtime.
 */
export interface RuleForMatching {
  /** The category assigned when every condition matches. */
  readonly category_id: string
  /** Conditions that must all match for the rule to apply. */
  readonly conditions: readonly ConditionForMatching[]
}
