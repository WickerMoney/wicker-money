/** An enabled category as offered to a picker: identity and parentage only. */
export interface CategoryPick {
  /** Category id. */
  readonly id: string
  /** Display name. */
  readonly name: string
  /** The parent category's id, or `null` for a top-level category. */
  readonly parent_id: string | null
}
