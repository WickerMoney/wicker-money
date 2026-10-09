/** What the account line form submits: the allowance for the month being shown. */
export interface AccountLineDraft {
  readonly accountId: string
  /** The allowance as typed. */
  readonly planned: string
  readonly rollover: boolean
  readonly excludedCategoryIds: readonly string[]
  readonly note: string | null
}
