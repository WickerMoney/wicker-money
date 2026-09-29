/**
 * @module
 * Fixed-point money for the recurrence module. Internal to the SDK.
 *
 * Same rules as the budgets plugin's `shared/money.ts`: amounts are
 * `numeric(19,4)` strings at every boundary and `bigint` units of 1/10,000 in
 * between, never `number`. Kept private for now so this module does not also
 * commit the SDK to a public money API; promoting it (and deleting the plugin
 * copies) is a separate decision.
 */

/** Integer units per whole currency unit. */
export const UNIT = 10_000n

const NUMERIC = /^-?\d+(\.\d+)?$/

/**
 * Parses a decimal string into units of 1/10,000.
 *
 * @param value - A plain decimal string such as `'-81.2'` or `'2850.0000'`.
 * @param label - What the value is, for the error message.
 * @returns The scaled amount. Digits beyond the fourth decimal place are
 *   truncated, since the column holds four.
 * @throws {RangeError} If `value` is not a plain decimal number.
 */
export function parseMoney(value: string, label = 'amount'): bigint {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!NUMERIC.test(text)) throw new RangeError(`Invalid ${label}: ${JSON.stringify(value)}`)
  const negative = text.startsWith('-')
  const [whole = '0', fraction = ''] = (negative ? text.slice(1) : text).split('.')
  const units = BigInt(whole) * UNIT + BigInt((fraction + '0000').slice(0, 4))
  return negative ? -units : units
}

/**
 * Formats units of 1/10,000 as a four-decimal string.
 *
 * @param units - The scaled amount.
 * @returns A string such as `'-81.2000'`; zero is always `'0.0000'`, never `'-0.0000'`.
 */
export function formatMoney(units: bigint): string {
  const negative = units < 0n
  const absolute = negative ? -units : units
  const fraction = (absolute % UNIT).toString().padStart(4, '0')
  return `${negative ? '-' : ''}${absolute / UNIT}.${fraction}`
}

/**
 * Divides and rounds half away from zero, so a value and its negation round
 * to mirror images (`-801.66665` and `801.66665` both move away from zero).
 *
 * @param numerator - Dividend.
 * @param denominator - Divisor; must be positive.
 * @returns The rounded quotient.
 */
export function divideRounded(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n
  const absolute = negative ? -numerator : numerator
  const q = (absolute * 2n + denominator) / (denominator * 2n)
  return negative ? -q : q
}
