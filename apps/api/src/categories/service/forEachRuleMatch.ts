import type { CategoryRuleRepository } from '../repository/CategoryRuleRepository.js'
import type { RuleCandidate } from '../repository/RuleCandidate.js'
import { matches, type MatchCondition } from '../engine.js'
import { RULE_PAGE_SIZE } from './RULE_PAGE_SIZE.js'

/**
 * Streams the transactions a rule matches, one page at a time.
 *
 * Candidates are read with keyset paging, so memory stays bounded by
 * {@link RULE_PAGE_SIZE} no matter how many transactions exist, and the
 * callback can update rows without disturbing the scan.
 *
 * @param rules - Rule repository bound to the current user's transaction.
 * @param conditions - The conditions a transaction must satisfy (all of them).
 * @param includeCategorized - Whether already-categorized, non-manual rows are eligible.
 * @param onPage - Called once per page with the matching subset (possibly empty)
 * and the number of candidates the page contained.
 */
export async function forEachRuleMatch(
  rules: CategoryRuleRepository,
  conditions: readonly MatchCondition[],
  includeCategorized: boolean,
  onPage: (hits: readonly RuleCandidate[], pageSize: number) => Promise<void>,
): Promise<void> {
  let afterId: string | null = null
  for (;;) {
    const page: RuleCandidate[] = await rules.candidatePage({ includeCategorized, afterId, limit: RULE_PAGE_SIZE })
    if (page.length === 0) return
    await onPage(page.filter((t) => matches(conditions, t)), page.length)
    afterId = (page[page.length - 1] as RuleCandidate).id
    if (page.length < RULE_PAGE_SIZE) return
  }
}
