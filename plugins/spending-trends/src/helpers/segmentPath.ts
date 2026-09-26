import type { SegmentRounding } from '../models/index.js'

/**
 * Draws a bar segment as an SVG path, with one end optionally rounded.
 *
 * A `rect` rounds all four corners, which would cut notches between stacked
 * segments. A path rounds only the outer end.
 *
 * @param x - Left edge.
 * @param y - Top edge.
 * @param width - Width.
 * @param height - Height.
 * @param radius - The rounding radius, reduced to fit a narrow or short segment.
 * @param rounding - Which end to round.
 * @returns The path's `d` attribute.
 */
export function segmentPath(
  x: number, y: number, width: number, height: number, radius: number, rounding: SegmentRounding,
): string {
  const r = Math.max(0, Math.min(radius, width / 2, height))
  const right = x + width
  const bottom = y + height
  if (rounding === 'top' && r > 0) {
    return `M${x},${y + r} A${r},${r} 0 0 1 ${x + r},${y} H${right - r} A${r},${r} 0 0 1 ${right},${y + r} V${bottom} H${x} Z`
  }
  if (rounding === 'bottom' && r > 0) {
    return `M${x},${y} H${right} V${bottom - r} A${r},${r} 0 0 1 ${right - r},${bottom} H${x + r} A${r},${r} 0 0 1 ${x},${bottom - r} Z`
  }
  return `M${x},${y} H${right} V${bottom} H${x} Z`
}
