/** Net spend for one category in one month, as seeded into the in-memory store. */
export interface SpendEntry {
  readonly userId: string
  readonly categoryId: string
  /** The month as `YYYY-MM`. */
  readonly monthKey: string
  /** Net spend as a decimal string; negative when refunds exceed spending. */
  readonly spent: string
}
