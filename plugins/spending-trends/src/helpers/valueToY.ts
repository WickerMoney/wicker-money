import type { NiceScale } from '../models/index.js'
import { TREND_LAYOUT, type TrendLayout } from './TREND_LAYOUT.js'

/**
 * Builds the function that maps a value on the axis to a y coordinate.
 *
 * @param scale - The axis limits.
 * @param layout - The drawing box; the full design width when omitted.
 * @returns A function from a signed value to a y coordinate in SVG units; the
 *   top of the axis lands on the top padding and the bottom on the bottom one.
 */
export function valueToY(scale: NiceScale, layout: TrendLayout = TREND_LAYOUT): (value: number) => number {
  const { height, pad } = layout
  const plotHeight = height - pad.top - pad.bottom
  const span = scale.top - scale.bottom
  return (value) => pad.top + ((scale.top - value) / span) * plotHeight
}
