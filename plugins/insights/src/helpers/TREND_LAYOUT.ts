/**
 * The trend chart's drawing box and margins, in SVG units.
 *
 * A wide, shallow band: the widget spans the dashboard, so the drawing has to
 * be the same shape or it stretches into a wall.
 */
export const TREND_LAYOUT = {
  width: 1200,
  height: 300,
  pad: { top: 18, right: 12, bottom: 30, left: 76 },
  /** Surface gap between adjacent bars. */
  barGap: 2,
  /** Rounded data-end radius, anchored to the zero line. */
  radius: 4,
} as const
