import { z } from 'zod'
import { ACCOUNT_TYPES } from './ACCOUNT_TYPES.js'
import { moneyString } from './moneyString.js'

/** Request body for creating an account. Balances and the currency default to zero and USD. */
export const createAccountBody = z.object({
  name: z.string().trim().min(1).max(200),
  accountType: z.enum(ACCOUNT_TYPES),
  initialBalance: moneyString.default('0'),
  currencyCode: z.string().length(3).toUpperCase().default('USD'),
  bufferAmount: moneyString.default('0'),
  // No default here: the service picks one from the account type.
  spendable: z.boolean().optional(),
})
