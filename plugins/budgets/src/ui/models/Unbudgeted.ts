/** A category that had spending in the month but no budget line. */
export interface Unbudgeted {
  readonly categoryId: string
  readonly categoryName: string
  /** Decimal string. */
  readonly spent: string
}
