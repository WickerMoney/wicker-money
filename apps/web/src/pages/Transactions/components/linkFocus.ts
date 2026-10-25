/** The DOM id of one transaction's Link button. */
export const linkButtonId = (transactionId: string): string => `recur-link-${transactionId}`

/** The DOM id of one transaction's picker. */
export const pickerId = (transactionId: string): string => `recur-picker-${transactionId}`
