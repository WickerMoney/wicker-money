import { createTransactionBody } from './createTransactionBody.js'

/**
 * Request body for editing a transaction: every creation field is optional
 * except that the owning account cannot be changed.
 */
export const updateTransactionBody = createTransactionBody.partial().omit({ accountId: true })
