import { z } from 'zod'
import { MAX_TRANSACTION_IDS } from '../../service/RecurringOccurrenceService.js'

/** Query for a transaction-matches request: `transactionIds`, comma-separated, one page of the transaction list at most. */
export const transactionMatchesQuery = z.object({
  transactionIds: z
    .string()
    .transform((value) => value.split(',').map((s) => s.trim()).filter((s) => s !== ''))
    .pipe(z
      .array(z.string().uuid('transactionIds must be UUIDs.'))
      .min(1, 'transactionIds must name at least one transaction.')
      .max(MAX_TRANSACTION_IDS, `transactionIds may name at most ${MAX_TRANSACTION_IDS} transactions.`)),
})

/** Route params addressing one transaction. */
export const transactionParams = z.object({
  transactionId: z.string().uuid('transactionId must be a UUID.'),
})
