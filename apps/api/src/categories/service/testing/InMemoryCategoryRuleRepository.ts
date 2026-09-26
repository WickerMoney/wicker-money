import { randomUUID } from 'node:crypto'
import type { CategoryRule, CategoryRuleCondition } from '../../../db/models/index.js'
import type { MatchRule } from '../../engine.js'
import type { CategoryRuleRepository } from '../../repository/CategoryRuleRepository.js'
import type { NewConditionInput } from '../../repository/NewConditionInput.js'
import type { NewRuleInput } from '../../repository/NewRuleInput.js'
import type { RuleCandidate } from '../../repository/RuleCandidate.js'
import type { RuleWithConditions } from '../../repository/RuleWithConditions.js'
import type { FakeCategoryState } from './FakeCategoryState.js'

/**
 * A {@link CategoryRuleRepository} over in-memory state.
 *
 * `candidatePage` honours the repository contract: transfer legs and manually
 * categorized rows are never returned, keyset paging is by ascending id, and
 * every requested `limit` is recorded in `state.pageLimits`.
 */
export class InMemoryCategoryRuleRepository implements CategoryRuleRepository {
  /**
   * @param state - Shared state.
   * @param userId - The user whose rows are visible.
   */
  constructor(
    private readonly state: FakeCategoryState,
    private readonly userId: string,
  ) {}

  private ordered(): CategoryRule[] {
    const conditionCount = (id: string): number => this.state.conditions.filter((c) => c.rule_id === id).length
    return this.state.rules
      .filter((r) => r.user_id === this.userId)
      .sort(
        (a, b) =>
          b.priority - a.priority ||
          conditionCount(b.id) - conditionCount(a.id) ||
          a.created_at.getTime() - b.created_at.getTime(),
      )
  }

  /** @inheritdoc */
  listWithConditions(): Promise<RuleWithConditions[]> {
    return Promise.resolve(
      this.ordered().map((r) => ({ ...r, conditions: this.state.conditions.filter((c) => c.rule_id === r.id) })),
    )
  }

  /** @inheritdoc */
  fetchForMatching(): Promise<MatchRule[]> {
    return Promise.resolve(
      this.ordered()
        .map((r) => ({
          category_id: r.category_id,
          conditions: this.state.conditions.filter((c) => c.rule_id === r.id),
        }))
        .filter((r) => r.conditions.length > 0),
    )
  }

  /** @inheritdoc */
  insertRule(input: NewRuleInput): Promise<CategoryRule> {
    const now = new Date()
    const row: CategoryRule = {
      id: randomUUID(),
      user_id: input.userId,
      category_id: input.categoryId,
      priority: input.priority,
      created_at: now,
      updated_at: now,
    }
    this.state.rules.push(row)
    return Promise.resolve({ ...row })
  }

  /** @inheritdoc */
  insertConditions(conditions: readonly NewConditionInput[]): Promise<CategoryRuleCondition[]> {
    const rows = conditions.map(({ userId, ruleId, ...columns }): CategoryRuleCondition => ({
      id: randomUUID(),
      user_id: userId,
      rule_id: ruleId,
      created_at: new Date(),
      ...columns,
    }))
    this.state.conditions.push(...rows)
    return Promise.resolve(rows.map((r) => ({ ...r })))
  }

  /** @inheritdoc */
  delete(id: string): Promise<boolean> {
    const before = this.state.rules.length
    this.state.rules = this.state.rules.filter((r) => !(r.user_id === this.userId && r.id === id))
    this.state.conditions = this.state.conditions.filter((c) => c.rule_id !== id)
    return Promise.resolve(this.state.rules.length < before)
  }

  /** @inheritdoc */
  candidatePage(options: {
    readonly includeCategorized: boolean
    readonly afterId: string | null
    readonly limit: number
  }): Promise<RuleCandidate[]> {
    this.state.pageLimits.push(options.limit)
    const page = this.state.transactions
      .filter((t) => t.userId === this.userId && t.transferId === null)
      .filter((t) =>
        options.includeCategorized ? t.categoryId === null || t.categorySource !== 'manual' : t.categoryId === null,
      )
      .filter((t) => options.afterId === null || t.id > options.afterId)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .slice(0, options.limit)
      .map((t) => ({ id: t.id, merchant: t.merchant, notes: t.notes, category_id: t.categoryId, amount: t.amount }))
    return Promise.resolve(page)
  }
}
