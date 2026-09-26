/** One part of a split transaction. */
export interface SplitPart {
  /** Signed decimal string; must share the parent's sign. */
  readonly amount: string
  readonly categoryId?: string | null | undefined
  readonly notes?: string | null | undefined
}
