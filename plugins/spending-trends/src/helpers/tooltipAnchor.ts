import type { TooltipAnchor } from '../models/index.js'

/** Clear space between the bar and the tooltip, in SVG units. */
const GAP = 10

/**
 * Decides where the tooltip goes: beside the bar, on whichever side has more room.
 *
 * Bars in the left half get the tooltip on their right, and the rest on their
 * left, so it never runs off the chart and never covers the bar it describes.
 *
 * @param barLeft - The bar's left edge, in SVG units.
 * @param barWidth - The bar's width.
 * @param chartWidth - The chart's full width.
 * @returns The anchoring edge as a percentage of the chart's width, and which way the tooltip extends from it.
 */
export function tooltipAnchor(barLeft: number, barWidth: number, chartWidth: number): TooltipAnchor {
  const centre = barLeft + barWidth / 2
  if (centre < chartWidth / 2) {
    return { leftPercent: ((barLeft + barWidth + GAP) / chartWidth) * 100, side: 'right' }
  }
  return { leftPercent: ((barLeft - GAP) / chartWidth) * 100, side: 'left' }
}
