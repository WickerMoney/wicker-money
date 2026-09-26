import { z } from 'zod'

/** Condition matching a merchant name exactly. */
export const merchantExactBody = z.object({
  conditionType: z.literal('merchant_exact'),
  textValue: z.string().trim().min(1).max(500),
  isCaseSensitive: z.boolean().default(false),
})
