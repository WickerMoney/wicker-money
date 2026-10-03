/**
 * Divides integer money units and rounds half away from zero.
 *
 * This is the one rounding rule in the SDK, and it is the API's too
 * (`decimal.js` with `ROUND_HALF_UP`, which rounds ties away from zero). An
 * amount and its negation round to mirror images, so `-0.00005` and `0.00005`
 * both move away from zero and a refund nets exactly against its charge.
 *
 * To scale an amount by a fraction, multiply first and divide once:
 * `divideUnits(units * 26n, 12n)` for a biweekly amount per month.
 *
 * @param numerator - Dividend, in units of 0.0001 (or a product of them).
 * @param denominator - Divisor; any non-zero `bigint`.
 * @returns The quotient rounded to a whole unit, half away from zero.
 * @throws {RangeError} If `denominator` is zero.
 * @example
 * divideUnits(5n, 2n)  // 3n
 * divideUnits(-5n, 2n) // -3n
 */
export function divideUnits(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError('Division by zero')
  const negative = (numerator < 0n) !== (denominator < 0n)
  const n = numerator < 0n ? -numerator : numerator
  const d = denominator < 0n ? -denominator : denominator
  const quotient = (n * 2n + d) / (d * 2n)
  return negative ? -quotient : quotient
}
