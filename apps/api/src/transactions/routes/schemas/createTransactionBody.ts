import { z } from 'zod'
import { isoDate } from './isoDate.js'
import { moneyString } from './moneyString.js'

/** Request body for creating a single (non-transfer) transaction. */
export const createTransactionBody = z.object({
  accountId: z.string().uuid(),
  amount: moneyString,
  merchant: z.string().trim().min(1).max(300),
  transactionDate: isoDate,
  categoryId: z.string().uuid().nullish(),
  notes: z.string().max(1000).nullish(),
  externalId: z.string().max(255).nullish(),
  /**
   * Accepted only so a request carrying it can be refused with a specific
   * message.
   *
   * A transfer is two rows and a single-transaction write produces one. The
   * database check constraint rejects a lone transfer row, but that surfaces as
   * a 500 with a constraint name in it; pointing the caller at the transfer
   * endpoint is more useful.
   */
  transferAccountId: z.string().uuid().nullish(),
})
