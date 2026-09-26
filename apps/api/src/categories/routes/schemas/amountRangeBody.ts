import { z } from 'zod'
import { directionBody } from './directionBody.js'
import { positiveMoney } from './positiveMoney.js'

/**
 * Condition matching an amount within a range.
 *
 * Either bound may be omitted, so "out, at least 500" needs no sentinel
 * maximum. The rule-level schema rejects a range with neither bound.
 */
export const amountRangeBody = z.object({
  conditionType: z.literal('amount_range'),
  direction: directionBody,
  amountMin: positiveMoney.nullish(),
  amountMax: positiveMoney.nullish(),
})
