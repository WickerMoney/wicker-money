/**
 * Builds the SVG path of one donut segment.
 *
 * @param cx - Centre x.
 * @param cy - Centre y.
 * @param rOuter - Outer radius.
 * @param rInner - Inner radius.
 * @param a0 - Start angle in degrees, measured clockwise from twelve o'clock.
 * @param a1 - End angle in degrees, measured the same way.
 * @returns The `d` attribute for a `<path>`.
 */
export function arc(
  cx: number, cy: number, rOuter: number, rInner: number, a0: number, a1: number,
): string {
  const p = (r: number, a: number) => {
    const rad = ((a - 90) * Math.PI) / 180
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)]
  }
  const large = a1 - a0 > 180 ? 1 : 0
  const [x0, y0] = p(rOuter, a0)
  const [x1, y1] = p(rOuter, a1)
  const [x2, y2] = p(rInner, a1)
  const [x3, y3] = p(rInner, a0)
  return [
    `M ${x0} ${y0}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${x1} ${y1}`,
    `L ${x2} ${y2}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${x3} ${y3}`,
    'Z',
  ].join(' ')
}
