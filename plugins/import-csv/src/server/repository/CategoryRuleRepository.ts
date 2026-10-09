import type { RuleForMatching } from '@wickermoney/plugin-sdk/server'

/** Read access to the user's category rules. */
export interface CategoryRuleRepository {
  /**
   * Loads the user's rules in resolution order, conditions included.
   *
   * @returns The rules, ready to hand to the category resolver.
   */
  loadForMatching(): Promise<readonly RuleForMatching[]>
}
