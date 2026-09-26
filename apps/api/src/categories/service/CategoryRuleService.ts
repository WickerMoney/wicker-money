import type { UnitOfWork } from '../../data/UnitOfWork.js'
import { NotFoundError } from '../../errors.js'
import type { MatchRule } from '../engine.js'
import type { RuleWithConditions } from '../repository/RuleWithConditions.js'
import { applyRule } from './applyRule.js'
import type { CreatedRule } from './CreatedRule.js'
import { forEachRuleMatch } from './forEachRuleMatch.js'
import type { NewRule } from './NewRule.js'
import type { RulePreview } from './RulePreview.js'
import { toConditionColumns } from './toConditionColumns.js'

/** Business rules for auto-categorization rules. */
export class CategoryRuleService {
  /** @param uow - Opens transactions and supplies repositories. */
  constructor(private readonly uow: UnitOfWork) {}

  /**
   * @param userId - The signed-in user.
   * @returns Every rule with its conditions, in the order they resolve.
   */
  list(userId: string): Promise<RuleWithConditions[]> {
    return this.uow.forUser(userId, (r) => r.categoryRules.listWithConditions())
  }

  /**
   * Creates a rule with its conditions and applies it to eligible transactions.
   *
   * @param userId - The signed-in user.
   * @param input - The rule.
   * @returns The stored rule with its conditions, and how many transactions it was applied to.
   * @throws {NotFoundError} If the target category does not exist or belongs to someone else.
   */
  create(userId: string, input: NewRule): Promise<CreatedRule> {
    return this.uow.forUser(userId, async (repos) => {
      // Checked up front: leaving it to the foreign key would surface as an opaque 500.
      if ((await repos.categories.findNode(input.categoryId)) === undefined) throw new NotFoundError('Category')
      const rule = await repos.categoryRules.insertRule({
        userId,
        categoryId: input.categoryId,
        priority: input.priority,
      })
      const conditions = await repos.categoryRules.insertConditions(
        input.conditions.map((c) => ({ userId, ruleId: rule.id, ...toConditionColumns(c) })),
      )
      const matchRule: MatchRule = { category_id: rule.category_id, conditions }
      const recategorized = await applyRule(repos, matchRule, input.applyToExisting)
      return { rule: { ...rule, conditions }, recategorized }
    })
  }

  /**
   * Dry run: counts the transactions a rule would touch without changing any.
   * Uses the same eligibility and matching as {@link CategoryRuleService.create}.
   *
   * @param userId - The signed-in user.
   * @param input - The rule to evaluate.
   * @returns How many uncategorized and already-categorized transactions would change.
   */
  preview(userId: string, input: NewRule): Promise<RulePreview> {
    return this.uow.forUser(userId, async ({ categoryRules }) => {
      const conditions = input.conditions.map(toConditionColumns)
      let wouldCategorize = 0
      let wouldRecategorize = 0
      await forEachRuleMatch(categoryRules, conditions, input.applyToExisting, async (hits) => {
        for (const t of hits) {
          if (t.category_id === null) wouldCategorize += 1
          else wouldRecategorize += 1
        }
      })
      return { wouldCategorize, wouldRecategorize }
    })
  }

  /**
   * @param userId - The signed-in user.
   * @param id - The rule.
   * @throws {NotFoundError} If it does not exist.
   */
  async delete(userId: string, id: string): Promise<void> {
    const deleted = await this.uow.forUser(userId, (r) => r.categoryRules.delete(id))
    if (!deleted) throw new NotFoundError('Category rule')
  }
}
