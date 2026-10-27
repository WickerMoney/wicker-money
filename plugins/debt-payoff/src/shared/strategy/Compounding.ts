/**
 * How a debt's interest is worked out each month.
 *
 * - `monthly`: `balance × APR ÷ 12`, the nominal monthly rate a statement
 *   quotes. This is what every debt used before the option existed.
 * - `daily`: compounded daily, `balance × ((1 + APR ÷ 365)^days − 1)` for the
 *   days in that calendar month. Typical of credit cards.
 * - `daily_simple`: simple daily interest, `principal × APR ÷ 365 × days`. While
 *   a debt is deferred the principal is what was owed at the start less
 *   anything paid, so interest does not earn interest until repayment begins,
 *   when it is added to the balance. Typical of student loans.
 */
export type Compounding = 'monthly' | 'daily' | 'daily_simple'

/** Every {@link Compounding} value, `monthly` first because it is the default. */
export const COMPOUNDING_OPTIONS: readonly Compounding[] = ['monthly', 'daily', 'daily_simple']
