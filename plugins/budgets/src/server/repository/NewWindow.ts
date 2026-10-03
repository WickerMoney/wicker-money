/** What a repository needs to create or update one window. */
export interface NewWindow {
  readonly categoryId: string
  /** First day of the window, inclusive, `YYYY-MM-DD`. */
  readonly periodStart: string
  /** First day after the window, exclusive, `YYYY-MM-DD`. */
  readonly periodEnd: string
  /** The funded amount as a non-negative decimal string. */
  readonly planned: string
  readonly note: string | null
}
