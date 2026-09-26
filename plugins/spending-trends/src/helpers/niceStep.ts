/**
 * Rounds a raw gridline spacing up to 1, 2, 5 or 10 times a power of ten.
 *
 * Whole currency units only, and no 2.5: tick labels are rounded to whole
 * units, so a spacing of 2.5 would label the gridlines $3, $5, $8 for values
 * that are really 2.5, 5, 7.5. Every step here is an integer for that reason,
 * and a spacing under 1 is raised to 1.
 *
 * @param raw - The unrounded spacing.
 * @returns A spacing that reads as round numbers, at least 1.
 */
export function niceStep(raw: number): number {
  if (!(raw > 0)) return 1
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const fraction = raw / magnitude
  let factor = 10
  if (fraction <= 1) factor = 1
  else if (fraction <= 2) factor = 2
  else if (fraction <= 5) factor = 5
  return Math.max(factor * magnitude, 1)
}
