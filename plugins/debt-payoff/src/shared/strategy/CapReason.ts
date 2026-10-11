/**
 * Why a scenario stopped with something still owing.
 *
 * - `month_limit`: it ran for {@link MAX_PLAN_MONTHS} months.
 * - `balance_limit`: a balance grew past what the database can hold, which
 *   only happens when a minimum is below the interest and nothing else pays it.
 */
export type CapReason = 'month_limit' | 'balance_limit'
