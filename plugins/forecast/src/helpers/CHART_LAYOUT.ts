/** Below this width (CSS pixels) the chart uses its compact layout. */
const COMPACT_BELOW = 640

/**
 * The forecast chart's drawing box and margins, in CSS pixels, for the width
 * it is rendered at. The box matches the element, so text stays at its
 * designed size on a phone and a wide monitor alike; only the plot stretches.
 *
 * @param width - The chart element's width.
 * @returns Width, height and padding.
 */
export function chartLayout(width: number) {
  const compact = width < COMPACT_BELOW
  return {
    width: Math.max(width, 280),
    height: compact ? 220 : 320,
    pad: compact
      ? { top: 12, right: 8, bottom: 26, left: 56 }
      : { top: 16, right: 16, bottom: 30, left: 84 },
  }
}
