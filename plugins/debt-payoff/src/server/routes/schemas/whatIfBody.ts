import { z } from 'zod'
import { isTimeZone } from '../../service/isTimeZone.js'
import { allocationsField, amountField, onDateField } from './lumpSumFields.js'
import { moneyField } from './moneyField.js'
import { strategyField } from './strategyField.js'

/**
 * The body of `POST /plan/what-if`: the lump sum to try (`onDate`, `amount`,
 * and optionally `allocations`) and, optionally, the `strategy`, `extra` and
 * `tz` to plan with; any left out come from the saved settings and UTC.
 */
export const whatIfBody = z.strictObject({
  onDate: onDateField,
  amount: amountField,
  allocations: allocationsField.optional(),
  strategy: strategyField.optional(),
  extra: moneyField.optional(),
  tz: z.string().refine(isTimeZone, 'Send an IANA time zone such as America/New_York.').optional(),
})
