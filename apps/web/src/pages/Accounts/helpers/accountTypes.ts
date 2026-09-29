/** The account types the API accepts. */
export const ACCOUNT_TYPES = ['checking', 'savings', 'credit_card', 'loan', 'investment'] as const

/**
 * Types whose balance can count toward safe to spend. The API refuses the
 * rest: a card's balance is debt, and available credit is not spending money.
 */
export const SPENDABLE_TYPES: readonly string[] = ['checking', 'savings']
