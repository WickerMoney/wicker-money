/**
 * A number of months as people say it: "7 months", "2 years", "2 years 5 months".
 *
 * @param months - A whole number of months, zero or more.
 */
export function durationText(months: number): string {
  const years = Math.floor(months / 12)
  const rest = months % 12
  const y = `${years} ${years === 1 ? 'year' : 'years'}`
  const m = `${rest} ${rest === 1 ? 'month' : 'months'}`
  if (years === 0) return m
  return rest === 0 ? y : `${y} ${m}`
}
