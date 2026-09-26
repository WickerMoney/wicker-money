/** One stacked category: a named spending category, or the fold of everything past the limit. */
export interface TrendSeries {
  /**
   * Stable key: the category id, `uncategorized`, or `__other`.
   *
   * Not the name. Two categories under different parents can share a name, and
   * keying on it would merge their spending into one segment.
   */
  readonly id: string
  /** Display name. */
  readonly name: string
  /** Net spending across the whole range, an exact four-decimal string. Negative when refunds outweighed spending. */
  readonly total: string
  /** `true` for the "Other" fold, which takes the neutral colour instead of a palette slot. */
  readonly folded: boolean
}
