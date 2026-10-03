import { z } from 'zod'
import { isoDate } from '../../../transactions/routes/schemas/isoDate.js'

/** Query for an occurrences request: a half-open `[from, to)`, both optional, and optionally one item's. */
export const occurrencesQuery = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  itemId: z.string().uuid().optional(),
})
