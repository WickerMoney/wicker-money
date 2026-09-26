/** Dry-run result of a rule: how many transactions it would change. */
export interface RulePreview {
  /** Uncategorized transactions the rule would categorize. */
  readonly wouldCategorize: number
  /** Already-categorized transactions the rule would re-categorize. */
  readonly wouldRecategorize: number
}
