import { z } from 'zod'
import { isTimeZone } from '../../service/isTimeZone.js'
import { moneyField } from './moneyField.js'
import { strategyField } from './strategyField.js'

/**
 * The query string of `GET /plan`. Each parameter is optional: a strategy or
 * extra left out comes from the saved settings, and a time zone left out is
 * UTC. Other parameters are ignored.
 */
export const planQuery = z.object({
  strategy: strategyField.optional(),
  extra: moneyField.optional(),
  tz: z.string().refine(isTimeZone, 'Send an IANA time zone such as America/New_York.').optional(),
})
