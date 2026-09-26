import { z } from 'zod'

/** Condition matching a merchant name that contains some text. */
export const merchantContainsBody = z.object({
  conditionType: z.literal('merchant_contains'),
  textValue: z.string().trim().min(1).max(500),
  isCaseSensitive: z.boolean().default(false),
})
