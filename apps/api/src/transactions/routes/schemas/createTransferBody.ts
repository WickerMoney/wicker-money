import { z } from 'zod'
import { isoDate } from './isoDate.js'
import { moneyString } from './moneyString.js'

/** Request body for moving money between two of the caller's own accounts. */
export const createTransferBody = z.object({
  fromAccountId: z.string().uuid(),
  toAccountId: z.string().uuid(),
  /** A positive magnitude. Direction comes from the accounts, not the sign. */
  amount: moneyString,
  transactionDate: isoDate,
  description: z.string().trim().max(300).optional(),
  notes: z.string().max(1000).nullish(),
  /**
   * The source's own id for this transfer, stored on both legs. Each leg is
   * on a different account and the external id is unique per account, so
   * sending the same transfer twice is refused instead of doubled.
   */
  externalId: z.string().max(255).nullish(),
})
