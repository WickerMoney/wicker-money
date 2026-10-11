import { divideUnits } from '@wickermoney/plugin-sdk/money'

/** 12 months × 100 (a percentage to a fraction) × 10,000 (the scale of an APR in units). */
const DENOMINATOR = 12n * 100n * 10_000n

/**
 * One month's interest on a balance.
 *
 * `interest = balance × APR ÷ 12`, the nominal monthly rate that credit card
 * and instalment-loan statements use, computed exactly and rounded once.
 *
 * The rounding rule is the SDK's only one: half away from zero, to a whole
 * unit of 0.0001 (the scale the database stores), done by
 * {@link divideUnits} after multiplying so nothing is rounded twice. Balances
 * here are never negative, so "away from zero" is simply "up" on a tie. Every
 * other figure in a plan is a sum or difference of exact integers and is never
 * rounded.
 *
 * Lenders round to the cent, and some compute interest daily, so a real
 * statement can differ from this by a fraction of a cent a month on a card and
 * a little more on a daily-accrual loan. The plan is an estimate on a stated
 * convention, and its documentation says so.
 *
 * @param balanceUnits - The opening balance, in units of 0.0001. Not negative.
 * @param aprUnits - The APR percentage in units of 0.0001 of a percent: 24.99% is `249_900n`.
 * @returns The interest for one month, in units of 0.0001.
 */
export function monthlyInterest(balanceUnits: bigint, aprUnits: bigint): bigint {
  return divideUnits(balanceUnits * aprUnits, DENOMINATOR)
}
