/** One month of the stacked chart: each series' spending in it. */
export interface TrendMonth {
  /** The month as `YYYY-MM`. */
  readonly month: string
  /**
   * Spending per series id, as exact four-decimal strings.
   *
   * Every series has an entry in every month, zero when it had nothing, so a
   * reader never has to distinguish "no spending" from "missing".
   */
  readonly values: Readonly<Record<string, string>>
}
