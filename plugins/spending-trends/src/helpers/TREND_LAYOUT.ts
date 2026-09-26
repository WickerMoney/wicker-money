/**
 * The chart's drawing box and margins, in SVG units.
 *
 * A wide, shallow band: the widget spans the dashboard, so the drawing has to
 * be the same shape or it stretches into a wall.
 */
export const TREND_LAYOUT = {
  width: 1200,
  height: 300,
  pad: { top: 12, right: 12, bottom: 34, left: 76 },
  /** Fraction of a month's slot the bar occupies; the rest is the gap between bars. */
  barFill: 0.7,
  /** Rounded radius of the outer end of a stack. */
  radius: 4,
} as const
