/**
 * The outline of one band of a stacked area.
 *
 * @param bottom - The y of the band's lower edge at each point.
 * @param top - The y of its upper edge at each point.
 * @param x - The x of point `i`.
 * @returns An SVG path: along the top left to right, back along the bottom.
 */
export function areaPath(bottom: readonly number[], top: readonly number[], x: (i: number) => number): string {
  const along = top.map((y, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y.toFixed(1)}`)
  const back = bottom.map((y, i) => `L${x(i).toFixed(1)},${y.toFixed(1)}`).reverse()
  return `${along.join('')}${back.join('')}Z`
}
