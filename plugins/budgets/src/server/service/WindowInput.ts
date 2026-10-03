/** A validated request body for creating or updating a window. */
export interface WindowInput {
  /** The window to update, or `null` to create one. */
  readonly id: string | null
  readonly categoryId: string
  /** First day of the window, `YYYY-MM-DD`. */
  readonly start: string
  /** Last day of the window, inclusive, `YYYY-MM-DD`. */
  readonly through: string
  /** The funded amount as a non-negative decimal string. */
  readonly planned: string
  /** Trimmed text of at most 300 characters, or null when blank or absent. */
  readonly note: string | null
}
