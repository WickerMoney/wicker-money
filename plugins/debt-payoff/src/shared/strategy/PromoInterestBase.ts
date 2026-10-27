/**
 * What backdated (deferred) interest is charged on when a promotional balance
 * is not cleared in time.
 *
 * - `original`: the balance at the start of the plan, whatever is paid in the
 *   meantime. The more common issuer rule, and the more cautious estimate.
 * - `declining`: the balance as it falls with payments.
 *
 * Either way the interest is charged at the debt's standard APR for every
 * month of the promotion and added to the balance in the month it ends.
 */
export type PromoInterestBase = 'original' | 'declining'

/** Every {@link PromoInterestBase} value, `original` first because it is the default. */
export const PROMO_INTEREST_BASES: readonly PromoInterestBase[] = ['original', 'declining']
