/** The stored and looked-up facts about one line, before its status is derived. */
export interface LineFigures {
  readonly categoryId: string
  readonly categoryName: string
  readonly planned: string
  /** Balance carried in from earlier months, as a decimal string. */
  readonly carriedIn: string
  /** What the ledger says was spent in the month, as a decimal string. */
  readonly spent: string
  readonly rollover: boolean
}
