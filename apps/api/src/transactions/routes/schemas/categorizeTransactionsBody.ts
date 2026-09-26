import { z } from 'zod'

/** Request body for assigning one category to up to 500 transactions at once. */
export const categorizeTransactionsBody = z.object({
  transactionIds: z.array(z.string().uuid()).min(1).max(500),
  /** `null` clears the category. */
  categoryId: z.string().uuid().nullable(),
})
