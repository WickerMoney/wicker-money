/** The effect a rule would have if saved, as returned by `POST /category-rules/preview`. */
export interface RulePreview {
  /** Uncategorized transactions that would be filed under the rule's category. */
  readonly wouldCategorize: number
  /** Already-categorized transactions that would move to the rule's category. */
  readonly wouldRecategorize: number
}
