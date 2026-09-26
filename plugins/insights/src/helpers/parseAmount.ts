import { AMOUNT_UNIT } from './AMOUNT_UNIT.js'

const NUMERIC = /^-?\d+(\.\d+)?$/

/**
 * Parses a decimal string into integer units of 1/10,000, exactly.
 *
 * Going through `Number` would drop digits from any amount of more than about
 * fifteen significant digits and turn `0.1 + 0.2` into `0.30000000000000004`.
 *
 * @param value - A plain decimal string such as `'-81.2'` or `'120.0000'`.
 * @returns The amount scaled by 10,000. Fraction digits beyond the fourth are
 *   truncated, since the column the values come from holds four.
 * @throws {RangeError} If `value` is not a plain decimal number.
 */
export function parseAmount(value: string): bigint {
  const text = value.trim()
  if (!NUMERIC.test(text)) throw new RangeError(`Not an amount: ${value}`)

  const negative = text.startsWith('-')
  const [whole = '0', fraction = ''] = (negative ? text.slice(1) : text).split('.')
  const units = BigInt(whole) * AMOUNT_UNIT + BigInt((fraction + '0000').slice(0, 4))
  return negative ? -units : units
}
