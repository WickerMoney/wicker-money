/** The result of creating or updating a window. */
export interface SavedWindow {
  readonly id: string
  readonly categoryId: string
  /** First day of the window, `YYYY-MM-DD`. */
  readonly start: string
  /** Last day of the window, inclusive, `YYYY-MM-DD`. */
  readonly through: string
  /** The stored funded amount as a decimal string. */
  readonly planned: string
}
