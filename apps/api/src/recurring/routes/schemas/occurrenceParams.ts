import { z } from 'zod'
import { isoDate } from '../../../transactions/routes/schemas/isoDate.js'

/** Route params addressing one occurrence: its item and nominal date. */
export const occurrenceParams = z.object({
  id: z.string().uuid('id must be a UUID.'),
  date: isoDate,
})

/** Route params addressing one transaction matched to one occurrence. */
export const matchParams = occurrenceParams.extend({
  transactionId: z.string().uuid('transactionId must be a UUID.'),
})
