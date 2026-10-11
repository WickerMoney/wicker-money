/** The chart's drawing box and margins, in SVG units. See {@link chartLayout}. */
export interface ChartLayout {
  readonly width: number
  readonly height: number
  readonly pad: { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number }
}

const DESIGN_WIDTH = 1000
const NARROW = 560
const MIN_WIDTH = 260

/**
 * The drawing box for a card of a given width.
 *
 * The chart is drawn at about the width it is shown at, so a 11px label is
 * drawn at 11px on a phone rather than scaled down with the whole drawing.
 *
 * @param containerWidth - The card's width in px, or `null` when it is not known (tests, no `ResizeObserver`).
 */
export function chartLayout(containerWidth: number | null): ChartLayout {
  const width = containerWidth === null
    ? DESIGN_WIDTH
    : Math.max(MIN_WIDTH, Math.min(DESIGN_WIDTH, Math.round(containerWidth)))
  const narrow = width < NARROW
  return {
    width,
    height: narrow ? 220 : 300,
    pad: { top: 12, right: 14, bottom: 30, left: narrow ? 58 : 84 },
  }
}
