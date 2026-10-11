/** One band of the stacked chart: a debt, or the debts folded into "Other". */
export interface ChartBand {
  /** A debt id, or `'other'` for the folded band. */
  readonly id: string
  readonly name: string
  /** A CSS colour (a design token) that follows the debt, not its rank. */
  readonly color: string
  /** The balance at each month, from month 0 (today), as a number for drawing only. */
  readonly values: readonly number[]
}
