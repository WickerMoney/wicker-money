import type { CategoryRuleRepository } from './CategoryRuleRepository.js'
import type { Query } from './Query.js'
import type { RuleForMatching } from './RuleForMatching.js'

/**
 * {@link CategoryRuleRepository} that delegates to the host's rule loader.
 *
 * The plugin does not know the rule resolution order or a condition's column
 * shape; both live in the host function this wraps.
 */
export class QueryCategoryRuleRepository implements CategoryRuleRepository {
  /**
   * @param q - A query runner bound to the current user.
   * @param load - The host's loader, which reads rules through `q`.
   */
  constructor(
    private readonly q: Query,
    private readonly load: (q: Query) => Promise<readonly RuleForMatching[]>,
  ) {}

  /** @inheritdoc */
  loadForMatching(): Promise<readonly RuleForMatching[]> {
    return this.load(this.q)
  }
}
