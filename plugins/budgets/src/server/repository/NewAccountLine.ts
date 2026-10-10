/** What a repository needs to create or update one account line. */
export interface NewAccountLine {
  readonly accountId: string
  /** First day of the month, `YYYY-MM-DD`. */
  readonly periodStart: string
  /** First day of the next month, `YYYY-MM-DD`: the period is half-open. */
  readonly periodEnd: string
  /** Planned amount as a non-negative decimal string. */
  readonly planned: string
  readonly rollover: boolean
  readonly excludedCategoryIds: readonly string[]
  readonly note: string | null
}
