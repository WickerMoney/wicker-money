import type { Trend } from '../models/index.js'
import { ZERO_AMOUNT } from './ZERO_AMOUNT.js'

/**
 * Whether the chart has anything to draw.
 *
 * `!== zero`, not `> 0`: a month whose refunds exceeded its spending has a
 * negative total, which is real and has to be drawn. Testing for positive would
 * send such a month to the empty state while its own tooltip still had figures.
 *
 * @param trend - The chart's data.
 * @returns `true` when at least one month has a non-zero amount in some series.
 */
export function hasSpending(trend: Trend): boolean {
  return trend.months.some((m) => trend.series.some((s) => (m.values[s.id] ?? ZERO_AMOUNT) !== ZERO_AMOUNT))
}
