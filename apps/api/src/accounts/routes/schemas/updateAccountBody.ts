import { z } from 'zod'
import { ACCOUNT_TYPES } from './ACCOUNT_TYPES.js'
import { bufferAmount } from './bufferAmount.js'

/**
 * Request body for editing an account: every field is optional and only the
 * ones present are changed.
 *
 * Fields deliberately have no defaults here: a default would be applied to an
 * omitted field and silently overwrite the stored value (a PATCH naming only
 * `name` would reset the currency to USD and the buffer to zero).
 *
 * `initialBalance` cannot be changed here. Changing the opening balance shifts
 * every balance the account has ever reported, so it has its own
 * preview-then-commit flow rather than being one more optional field.
 */
export const updateAccountBody = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  accountType: z.enum(ACCOUNT_TYPES).optional(),
  currencyCode: z.string().length(3).toUpperCase().optional(),
  bufferAmount: bufferAmount.optional(),
  spendable: z.boolean().optional(),
})
