import { RECURRENCE_FREQUENCIES } from '@wickermoney/plugin-sdk/recurrence'
import { z } from 'zod'
import { isoDate } from '../../../transactions/routes/schemas/isoDate.js'
import { moneyString } from '../../../transactions/routes/schemas/moneyString.js'
import { MAX_LEGS } from '../../service/validateRecurringItem.js'
import { RECURRING_KINDS } from './RECURRING_KINDS.js'

/**
 * Request body for creating or rewriting a recurring item.
 *
 * Shape only: whether the legs fit the kind, the accounts exist and the
 * semimonthly days make sense is the service's job, so the same rules apply
 * however an item arrives.
 */
export const recurringItemBody = z.object({
  name: z.string().trim().min(1).max(200),
  kind: z.enum(RECURRING_KINDS),
  frequency: z.enum(RECURRENCE_FREQUENCIES),
  seriesStartDate: isoDate,
  endDate: isoDate.nullish(),
  semimonthlyDays: z.tuple([z.number().int(), z.number().int()]).nullish(),
  categoryId: z.string().uuid().nullish(),
  legs: z
    .array(z.object({ accountId: z.string().uuid(), amount: moneyString }))
    .min(1)
    .max(MAX_LEGS),
})
