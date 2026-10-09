/** A validated request body for creating or updating an account line. */
export interface AccountLineInput {
  /** The month the line belongs to, as `YYYY-MM`. */
  readonly monthKey: string
  readonly accountId: string
  /** The planned amount as a non-negative decimal string. */
  readonly planned: string
  readonly rollover: boolean
  /** Categories whose spending does not count, deduplicated. */
  readonly excludedCategoryIds: readonly string[]
  /** Trimmed text of at most 300 characters, or null when blank or absent. */
  readonly note: string | null
}
