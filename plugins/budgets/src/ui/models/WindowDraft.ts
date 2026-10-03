/** What the window form submits: a new window, or changes to one when `id` is set. */
export interface WindowDraft {
  /** The window being edited, or `null` for a new one. */
  readonly id: string | null
  readonly categoryId: string
  /** First day, `YYYY-MM-DD`. */
  readonly start: string
  /** Last day, inclusive, `YYYY-MM-DD`. */
  readonly through: string
  /** The amount the window is funded with, as typed. */
  readonly planned: string
  readonly note: string | null
}
