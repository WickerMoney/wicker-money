/**
 * A day of the month as people say it: `1st`, `2nd`, `23rd`, and `31` as
 * "last day", since a 31 clamps to the end of every shorter month.
 *
 * @param day - 1 to 31.
 * @returns The label.
 */
export function dayLabel(day: number): string {
  if (day === 31) return 'last day'
  const tens = day % 100
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][day % 10] ?? 'th'
  return `${day}${suffix}`
}
