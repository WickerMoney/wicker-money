import { z } from 'zod'
import { isoDate } from '../../../transactions/routes/schemas/isoDate.js'
import { moneyString } from '../../../transactions/routes/schemas/moneyString.js'
import { MAX_LEGS } from '../../service/validateRecurringItem.js'

/**
 * Request body recording how one occurrence differs from its series. Every
 * field replaces what was recorded; omitted ones reset to the series.
 * Whether the amounts fit the item is the service's job.
 */
export const occurrenceOverrideBody = z.object({
  skipped: z.boolean().default(false),
  expectedDate: isoDate.nullish().transform((v) => v ?? null),
  legs: z
    .array(z.object({ accountId: z.string().uuid(), amount: moneyString }))
    .max(MAX_LEGS)
    .nullish()
    .transform((v) => v ?? null),
})
