/** What a repository needs to create or update one budget line. */
export interface NewBudgetLine {
  readonly categoryId: string
  /** First day of the month, `YYYY-MM-DD`. */
  readonly periodStart: string
  /** Last day of the month, `YYYY-MM-DD`. */
  readonly periodEnd: string
  /** Planned amount as a non-negative decimal string. */
  readonly planned: string
  readonly rollover: boolean
  readonly note: string | null
}
