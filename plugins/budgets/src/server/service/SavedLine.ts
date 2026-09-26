/** The result of creating or updating a budget line. */
export interface SavedLine {
  readonly id: string
  readonly categoryId: string
  /** The stored planned amount as a decimal string. */
  readonly planned: string
  readonly rollover: boolean
}
