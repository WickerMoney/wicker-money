import type { TrendMonth, TrendSeries } from '../models/index.js'

/**
 * Finds how far the tallest stack reaches above and below the zero line.
 *
 * Positive spending stacks upward and a refund stacks downward, so the axis
 * needs room in both directions. Both are returned as magnitudes.
 *
 * Pixels, not money, so floats are fine from here on.
 *
 * @param months - The chart's months.
 * @param visible - The series currently shown.
 * @returns The largest upward and downward stack, each at least zero.
 */
export function stackExtent(
  months: readonly TrendMonth[],
  visible: readonly TrendSeries[],
): { readonly maxUp: number; readonly maxDown: number } {
  let maxUp = 0
  let maxDown = 0
  for (const month of months) {
    let up = 0
    let down = 0
    for (const s of visible) {
      const v = Number(month.values[s.id] ?? 0)
      if (v > 0) up += v
      else down -= v
    }
    maxUp = Math.max(maxUp, up)
    maxDown = Math.max(maxDown, down)
  }
  return { maxUp, maxDown }
}
