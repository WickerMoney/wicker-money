/** The result of creating or updating an account line. */
export interface SavedAccountLine {
  readonly id: string
  readonly accountId: string
  /** The stored planned amount as a decimal string. */
  readonly planned: string
  readonly rollover: boolean
  readonly excludedCategoryIds: readonly string[]
}
