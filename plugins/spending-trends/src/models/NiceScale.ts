/** A y-axis that starts and ends on tick marks, so no bar is cut off and every gridline has a round number. */
export interface NiceScale {
  /** The value at the top of the plot. */
  readonly top: number
  /** The value at the bottom of the plot: zero, or negative when a stack extends below the line. */
  readonly bottom: number
  /** Every gridline value, lowest first; always includes zero. */
  readonly ticks: readonly number[]
}
