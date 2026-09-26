import type { Repositories } from '../../data/Repositories.js'
import type { MatchRule } from '../engine.js'
import { forEachRuleMatch } from './forEachRuleMatch.js'

/**
 * Applies a rule to every eligible transaction it matches, marking each as
 * categorized by a rule.
 *
 * @param repos - Repositories bound to the current user's transaction.
 * @param rule - The rule's target category and conditions.
 * @param includeCategorized - Whether already-categorized, non-manual rows are eligible.
 * @returns The number of transactions updated.
 */
export async function applyRule(
  repos: Pick<Repositories, 'categoryRules' | 'transactions'>,
  rule: MatchRule,
  includeCategorized: boolean,
): Promise<number> {
  let updated = 0
  await forEachRuleMatch(repos.categoryRules, rule.conditions, includeCategorized, async (hits) => {
    updated += await repos.transactions.assignCategory(
      hits.map((t) => t.id),
      rule.category_id,
      'rule',
    )
  })
  return updated
}
