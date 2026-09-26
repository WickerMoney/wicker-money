import type { FlatRuleConditionRow } from './FlatRuleConditionRow.js'

/**
 * A tagged-template query runner: it takes a SQL template and resolves to the
 * result rows. `kyselyRunner` adapts Kysely to this shape, and a plugin's scoped
 * query function already satisfies it directly.
 */
export type RuleRowRunner = <T = FlatRuleConditionRow>(
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<T[]>
