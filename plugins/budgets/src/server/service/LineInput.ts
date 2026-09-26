/** A validated request body for creating or updating a budget line. */
export interface LineInput {
  /** The month the line belongs to, as `YYYY-MM`. */
  readonly monthKey: string
  readonly categoryId: string
  /** The planned amount as a non-negative decimal string. */
  readonly planned: string
  readonly rollover: boolean
  /** Trimmed text of at most 300 characters, or null when blank or absent. */
  readonly note: string | null
}
