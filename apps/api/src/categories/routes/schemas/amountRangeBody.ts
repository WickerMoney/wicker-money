import { z } from 'zod'
import { directionBody } from './directionBody.js'
import { positiveMoneyWith } from './positiveMoney.js'

/**
 * Condition matching an amount within a range.
 *
 * Either bound may be omitted, so "out, at least 500" needs no sentinel
 * maximum. The rule-level schema rejects a range with neither bound.
 *
 * Zero is refused for both bounds. "At least 0" would mean the same as no
 * minimum, so the message points there instead of leaving two ways to say
 * one thing; "at most 0" could only match nothing, since amounts are
 * magnitudes.
 */
export const amountRangeBody = z.object({
  conditionType: z.literal('amount_range'),
  direction: directionBody,
  amountMin: positiveMoneyWith('Must be more than 0. Leave it empty for no minimum.').nullish(),
  amountMax: positiveMoneyWith('Must be more than 0. Leave it empty for no maximum.').nullish(),
})
