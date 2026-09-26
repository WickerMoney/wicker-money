import type { CategoryRule, CategoryRuleCondition } from '../../db/models/index.js'
import type { MatchRule } from '../engine.js'
import type { NewConditionInput } from './NewConditionInput.js'
import type { NewRuleInput } from './NewRuleInput.js'
import type { RuleCandidate } from './RuleCandidate.js'
import type { RuleWithConditions } from './RuleWithConditions.js'

/** Persistence operations for categorization rules and the transactions they act on. */
export interface CategoryRuleRepository {
  /**
   * Lists every rule with its conditions in resolution order: priority
   * descending, then condition count descending, then creation time ascending.
   *
   * @returns The rules, each with its conditions.
   */
  listWithConditions(): Promise<RuleWithConditions[]>

  /**
   * Loads rules in the shape the matching engine consumes, in resolution order.
   *
   * @returns Rules that have at least one condition.
   */
  fetchForMatching(): Promise<MatchRule[]>

  /**
   * @param input - The new rule.
   * @returns The inserted rule row.
   */
  insertRule(input: NewRuleInput): Promise<CategoryRule>

  /**
   * @param conditions - One or more conditions to insert.
   * @returns The inserted condition rows.
   */
  insertConditions(conditions: readonly NewConditionInput[]): Promise<CategoryRuleCondition[]>

  /**
   * @param id - Rule id.
   * @returns Whether a rule was deleted.
   */
  delete(id: string): Promise<boolean>

  /**
   * Reads one page of transactions a rule may act on, ordered by id.
   *
   * Uncategorized rows are always eligible. Rows categorized by an earlier rule,
   * an import or the AI are eligible only when `includeCategorized` is set.
   * Manually categorized rows and transfer legs are never eligible.
   *
   * @param options.includeCategorized - Whether already-categorized, non-manual rows qualify.
   * @param options.afterId - Return only rows with an id greater than this (keyset paging).
   * @param options.limit - Maximum rows in the page.
   * @returns Up to `limit` candidates, in ascending id order.
   */
  candidatePage(options: {
    readonly includeCategorized: boolean
    readonly afterId: string | null
    readonly limit: number
  }): Promise<RuleCandidate[]>
}
