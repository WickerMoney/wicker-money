import { divideUnits } from '@wickermoney/plugin-sdk/money'
import type { Compounding } from './Compounding.js'
import { monthlyInterest } from './monthlyInterest.js'

/** 365 days × 100 (a percentage to a fraction) × 10,000 (the scale of an APR in units). */
const DAILY_DENOMINATOR = 365n * 100n * 10_000n

/**
 * One month's interest on a balance under a compounding option.
 *
 * Exact integer arithmetic, rounded once, half away from zero, by the SDK's
 * `divideUnits`, the same rule {@link monthlyInterest} uses. `daily` raises
 * `(1 + rate)` to the number of days as an exact fraction, so there is no
 * floating point anywhere.
 *
 * @param mode - How the debt compounds.
 * @param base - The balance the interest is charged on, in units. Not negative.
 * @param aprUnits - The APR in units of 0.0001 of a percent.
 * @param days - The days in the month being worked out (28 to 31).
 * @returns The interest in units of 0.0001.
 */
export function periodInterest(mode: Compounding, base: bigint, aprUnits: bigint, days: number): bigint {
  if (mode === 'monthly') return monthlyInterest(base, aprUnits)
  const n = BigInt(days)
  if (mode === 'daily_simple') return divideUnits(base * aprUnits * n, DAILY_DENOMINATOR)
  const grown = (DAILY_DENOMINATOR + aprUnits) ** n
  const whole = DAILY_DENOMINATOR ** n
  return divideUnits(base * (grown - whole), whole)
}
