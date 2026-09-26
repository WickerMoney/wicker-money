/** One part of a split transaction to insert. */
export interface NewSplitInput {
  readonly userId: string
  readonly transactionId: string
  /** Signed decimal string. */
  readonly amount: string
  readonly categoryId: string | null
  readonly notes: string | null
}
