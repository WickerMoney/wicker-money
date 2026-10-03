/** One plotted point: a day's low and end-of-day balance, as numbers for drawing. */
export interface PlotPoint {
  readonly low: number
  readonly balance: number
}

/**
 * The SVG path of a step chart with each day's dip drawn in.
 *
 * A balance changes on a day, not smoothly between days, so the line is
 * flat across each day and moves at its boundary. Where a day's outflows
 * land before its inflows, the line drops to that day's low and comes back
 * up to its end balance, so rent due on payday shows as the dip it is rather
 * than hiding under the paycheck.
 *
 * @param points - Point 0 is today; the rest are the projected days in order.
 * @param x - Index to x coordinate; a day spans `x(i)` to `x(i + 1)`.
 * @param y - Value to y coordinate.
 * @returns The path's `d` attribute, or an empty string with no points.
 */
export function stepPath(points: readonly PlotPoint[], x: (i: number) => number, y: (v: number) => number): string {
  const first = points[0]
  if (first === undefined) return ''
  const parts = [`M${x(0)},${y(first.balance)}`]
  for (let i = 1; i < points.length; i += 1) {
    const p = points[i]!
    parts.push(`H${x(i)}`)
    if (p.low !== points[i - 1]!.balance) parts.push(`V${y(p.low)}`)
    if (p.balance !== p.low) parts.push(`V${y(p.balance)}`)
  }
  parts.push(`H${x(points.length)}`)
  return parts.join('')
}
