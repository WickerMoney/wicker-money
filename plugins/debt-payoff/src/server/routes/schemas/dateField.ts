import { addMonths } from '@wickermoney/plugin-sdk/date'
import { z } from 'zod'

const ISO = /^\d{4}-\d{2}-\d{2}$/

/** Whether text is a real calendar date written `YYYY-MM-DD`. */
function isRealDate(value: string): boolean {
  if (!ISO.test(value)) return false
  try {
    return addMonths(value, 0) === value
  } catch {
    return false
  }
}

/** A calendar date as a request carries it: `YYYY-MM-DD` and a day that exists. */
export const dateField = z
  .string({ error: 'Send the date as text, such as "2027-04-10".' })
  .refine(isRealDate, 'Enter a date as year-month-day, such as 2027-04-10.')
