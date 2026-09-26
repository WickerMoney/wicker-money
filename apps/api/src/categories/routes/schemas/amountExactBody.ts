import { z } from 'zod'
import { directionBody } from './directionBody.js'
import { positiveMoney } from './positiveMoney.js'

/**
 * Condition matching an exact amount.
 *
 * Amount conditions carry a positive magnitude plus a direction, never a
 * signed value. A car payment of 375.00 is
 * `{ conditionType: 'amount_exact', direction: 'out', amountValue: '375.00' }`,
 * not `'-375.00'`.
 */
export const amountExactBody = z.object({
  conditionType: z.literal('amount_exact'),
  direction: directionBody,
  amountValue: positiveMoney,
})
