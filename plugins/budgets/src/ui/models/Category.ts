/** A category as returned by the core category listing that plugins may read. */
export interface Category {
  readonly id: string
  readonly name: string
  /** The parent's id, or `null` for a top-level category. */
  readonly parent_id: string | null
  /** `expense`, `income` or `transfer`. Absent from servers older than budget windows. */
  readonly kind?: string
}
