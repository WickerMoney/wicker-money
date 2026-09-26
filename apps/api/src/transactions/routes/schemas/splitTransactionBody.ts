import { z } from 'zod'
import { moneyString } from './moneyString.js'

/** Request body for replacing a transaction's splits. Between two and 100 parts are required. */
export const splitTransactionBody = z.object({
  splits: z
    .array(
      z.object({
        amount: moneyString,
        categoryId: z.string().uuid().nullish(),
        notes: z.string().max(1000).nullish(),
      }),
    )
    .min(2, 'A split needs at least two parts.')
    .max(100, 'A split can have at most 100 parts.'),
})
