import { z } from 'zod'

/** Condition matching a transaction description (notes) that contains some text. */
export const descriptionContainsBody = z.object({
  conditionType: z.literal('description_contains'),
  textValue: z.string().trim().min(1).max(500),
  isCaseSensitive: z.boolean().default(false),
})
