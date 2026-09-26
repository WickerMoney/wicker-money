import { z } from 'zod'
import { isRealCalendarDate } from './isRealCalendarDate.js'

/** A calendar date written as `YYYY-MM-DD`. Both the format and the existence of the day are checked. */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD.')
  .refine(isRealCalendarDate, 'Must be a real calendar date.')
