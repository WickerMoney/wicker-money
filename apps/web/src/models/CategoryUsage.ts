/** What still references a category, as returned by `GET /categories/:id/usage`. */
export interface CategoryUsage {
  /** Total number of rows that reference the category. */
  readonly total: number
  /** The same total broken down per referencing table. */
  readonly by: readonly { readonly table: string; readonly count: number }[]
  /** Number of child categories beneath it. */
  readonly childCount: number
}
