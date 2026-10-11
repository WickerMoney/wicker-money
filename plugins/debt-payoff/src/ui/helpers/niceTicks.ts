/**
 * Round tick values from zero up to at least `max`, about `target` intervals.
 *
 * @param max - The tallest value to draw.
 * @param target - Roughly how many intervals to aim for.
 * @returns Ascending ticks starting at 0 whose last value is at or above `max`.
 */
export function niceTicks(max: number, target = 4): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0, 1]
  const raw = max / target
  const power = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? 10 * power
  const ticks = [0]
  while ((ticks[ticks.length - 1] ?? 0) < max) ticks.push(ticks.length * step)
  return ticks
}
