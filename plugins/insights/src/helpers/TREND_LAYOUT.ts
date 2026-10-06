/** The trend chart's drawing box and margins, in SVG units. See {@link trendLayout}. */
export interface TrendLayout {
  readonly width: number
  readonly height: number
  readonly pad: { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number }
  /** Surface gap between adjacent bars. */
  readonly barGap: number
  /** Rounded data-end radius, anchored to the zero line. */
  readonly radius: number
}

/** The widest the drawing is made; a wider card scales it up from here. */
const DESIGN_WIDTH = 1200
/** Below this the drawing gets a shorter box and a narrower label gutter. */
const NARROW = 640
/** The narrowest the drawing is made, so a sliver of a card is still drawable. */
const MIN_WIDTH = 280

/**
 * The drawing box for a card of a given width.
 *
 * The drawing is made at (about) the width it is shown at, so a 10px axis label
 * is drawn at about 10px instead of being scaled down with a 1200-unit viewBox.
 * A wide, shallow band at full width, because the widget spans the dashboard and
 * would otherwise stretch into a wall; on a phone, a shorter box and a narrower
 * label gutter.
 *
 * @param containerWidth - The card's width in px, or `null` when unknown.
 * @returns The layout; the full design width when the width is unknown.
 */
export function trendLayout(containerWidth: number | null): TrendLayout {
  const width = containerWidth === null
    ? DESIGN_WIDTH
    : Math.max(MIN_WIDTH, Math.min(DESIGN_WIDTH, Math.round(containerWidth)))
  const narrow = width < NARROW
  return {
    width,
    height: narrow ? 240 : 300,
    pad: { top: 18, right: 12, bottom: 30, left: narrow ? 64 : 76 },
    barGap: 2,
    radius: 4,
  }
}

/** The layout at the full design width: what the chart was before it measured itself. */
export const TREND_LAYOUT: TrendLayout = trendLayout(null)
