/** A category that had spending in the month but no budget line. */
export interface UnbudgetedSpend {
  readonly categoryId: string
  readonly categoryName: string
  /** Positive net spend as a decimal string. */
  readonly spent: string
}
