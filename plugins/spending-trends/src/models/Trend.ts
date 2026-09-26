import type { TrendMonth } from './TrendMonth.js'
import type { TrendSeries } from './TrendSeries.js'

/** The chart's data: which series exist, and how much each spent in each month. */
export interface Trend {
  /** Largest first, so the biggest category sits at the base of every stack; the "Other" fold is always last. */
  readonly series: readonly TrendSeries[]
  /** Oldest first. */
  readonly months: readonly TrendMonth[]
}
