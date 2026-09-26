import type { DateParts } from './DateParts.js'

/**
 * Validates date parts and formats them as ISO `YYYY-MM-DD`.
 *
 * Rejects a date that does not round-trip, so 31/02 fails rather than becoming
 * 3 March the way Date's own rollover would.
 *
 * @param parts - The numeric year, month and day.
 * @returns `{ value }` with the ISO date, or `{ error }` describing why it is not a real date.
 */
export function checkDateParts({ year, month, day }: DateParts): { value: string } | { error: string } {
  if (year < 1900 || year > 2200) return { error: `implausible year ${year}` }
  if (month < 1 || month > 12) return { error: `month ${month} out of range` }
  if (day < 1 || day > 31) return { error: `day ${day} out of range` }

  const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  const check = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(check.getTime()) || check.getUTCDate() !== day || check.getUTCMonth() + 1 !== month) {
    return { error: `${iso} is not a real date` }
  }
  return { value: iso }
}
