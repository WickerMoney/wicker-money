/** Net spend for one category on one day, as seeded into the in-memory store. */
export interface DatedSpend {
  readonly userId: string
  readonly categoryId: string
  /** The day, `YYYY-MM-DD`. */
  readonly date: string
  /** Net spend as a decimal string; negative for a refund. */
  readonly spent: string
}
