/**
 * The whole-window figures for a line that spans more than one month, as the
 * month endpoint reports them. Absent (`null`) on a monthly line.
 */
export interface LineWindow {
  /** First day of the window, `YYYY-MM-DD`. */
  readonly start: string
  /** Last day of the window, inclusive, `YYYY-MM-DD`. */
  readonly through: string
  /** What the window was funded with, as a decimal string. */
  readonly funded: string
  /** Spent in the window from its start through the month shown, as a decimal string. */
  readonly spentToDate: string
}
