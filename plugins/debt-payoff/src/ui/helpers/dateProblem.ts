import { addMonths } from '@wickermoney/plugin-sdk/date'

/**
 * Why a typed date cannot be saved, or `null` when it can.
 *
 * @param text - What the date field holds: `YYYY-MM-DD`, as a date input gives it.
 * @returns A message for the field, or `null`.
 */
export function dateProblem(text: string): string | null {
  const value = text.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'Enter a date as year-month-day, such as 2027-04-10.'
  try {
    return addMonths(value, 0) === value ? null : 'Enter a date that exists on the calendar.'
  } catch {
    return 'Enter a date that exists on the calendar.'
  }
}
