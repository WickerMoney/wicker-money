/** The whole-window figures for a line that spans more than one month. */
export interface LineWindow {
  /** First day of the window, `YYYY-MM-DD`. */
  readonly start: string
  /** Last day of the window, inclusive, `YYYY-MM-DD`. */
  readonly through: string
  /** Decimal string. What the window was funded with. */
  readonly funded: string
  /** Decimal string. Spent in the window from its start through the month shown. */
  readonly spentToDate: string
}
