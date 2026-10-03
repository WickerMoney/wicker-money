/**
 * Round-numbered axis ticks that cover a range: steps of 1, 2 or 5 times a
 * power of ten, so the labels read as $500 or $2,000 rather than $437.
 *
 * @param min - Lowest value to cover.
 * @param max - Highest value to cover.
 * @param target - Roughly how many intervals to aim for.
 * @returns Ascending tick values; the first is at or below `min`, the last at or above `max`.
 */
export function niceTicks(min: number, max: number, target = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0]
  if (min === max) {
    const pad = Math.max(Math.abs(min) * 0.1, 1)
    return niceTicks(min - pad, max + pad, target)
  }
  const raw = (max - min) / target
  const power = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? 10 * power
  const first = Math.floor(min / step) * step
  const ticks: number[] = []
  for (let v = first; v < max + step / 2; v += step) ticks.push(Math.round(v / step) * step)
  if (ticks[ticks.length - 1]! < max) ticks.push(ticks[ticks.length - 1]! + step)
  return ticks
}
