/** What the chart says about one month, for the tooltip and the live region. */
export interface MonthReadout {
  readonly index: number
  readonly date: string
  /** Total still owed, formatted. */
  readonly total: string
  /** Paid this month, formatted; `null` for the starting point. */
  readonly paid: string | null
  /** Interest this month, formatted; `null` for the starting point. */
  readonly interest: string | null
  /** The debts still owing, largest first, each with its formatted balance. */
  readonly rows: readonly { readonly name: string; readonly balance: string; readonly color: string }[]
  /** Names of the debts paid off this month. */
  readonly clearedNames: readonly string[]
}
