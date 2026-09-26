import type { StackSegment, TrendMonth, TrendSeries } from '../models/index.js'
import { ZERO_AMOUNT } from './ZERO_AMOUNT.js'

/**
 * Lays out one month's bar: a segment per visible series that spent anything.
 *
 * Spending stacks upward from the zero line in rank order, so the largest
 * category is the base. A negative amount, which is refunds outweighing
 * spending in that category, stacks downward instead: the sign decides the
 * direction, and clamping it to zero would draw nothing while the tooltip still
 * counted it.
 *
 * A category with exactly nothing gets no segment, not a stub, which would put a
 * mark where there is no money. Any other amount is at least one pixel tall.
 *
 * The outer end of each direction is marked for rounding, so the bar reads as
 * one shape rather than a pile of rounded pills.
 *
 * @param month - The month to lay out.
 * @param visible - The series currently shown, in rank order.
 * @param y - Converts a value to a y coordinate in SVG units.
 * @returns The segments, bottom-most first among the positives.
 */
export function stackMonth(
  month: TrendMonth,
  visible: readonly TrendSeries[],
  y: (value: number) => number,
): StackSegment[] {
  const segments: StackSegment[] = []
  let up = 0
  let down = 0
  let lastUp = -1
  let lastDown = -1

  for (const s of visible) {
    const value = month.values[s.id] ?? ZERO_AMOUNT
    const amount = Number(value)
    if (amount === 0) continue

    const from = amount > 0 ? up : down
    const to = from + amount
    if (amount > 0) {
      up = to
      lastUp = segments.length
    } else {
      down = to
      lastDown = segments.length
    }
    const top = y(Math.max(from, to))
    const bottom = y(Math.min(from, to))
    segments.push({ id: s.id, value, y: top, h: Math.max(bottom - top, 1), rounding: 'none' })
  }

  return segments.map((segment, i) => {
    if (i === lastUp) return { ...segment, rounding: 'top' }
    if (i === lastDown) return { ...segment, rounding: 'bottom' }
    return segment
  })
}
