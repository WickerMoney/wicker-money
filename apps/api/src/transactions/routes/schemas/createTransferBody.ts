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
})
