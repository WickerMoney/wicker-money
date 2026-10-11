import type { ChartBand } from './ChartBand.js'

/** The plan reshaped for drawing: one value per band per month. */
export interface ChartModel {
  /** The date of each point, from the start date. Index 0 is today. */
  readonly dates: readonly string[]
  /** Bands from the bottom of the stack to the top. */
  readonly bands: readonly ChartBand[]
  /** Total owed at each point. */
  readonly totals: readonly number[]
  /** The tallest total. */
  readonly max: number
}
