import { MONEY_SCALE } from './MONEY_SCALE.js'
import { MONEY_UNIT } from './MONEY_UNIT.js'

/** Optional minus, digits, and at most {@link MONEY_SCALE} fraction digits. */
const DECIMAL = /^-?\d+(?:\.\d{1,4})?$/

/**
 * Parses a decimal string into integer units of 0.0001, exactly.
 *
 * The parse is strict. More than four decimal places is an error, not a
 * rounding: the column holds four, so a fifth cannot have come from the
 * database, and quietly rounding or truncating a value someone typed would
 * store a number they never entered. The API refuses the same input, so a
 * plugin that validates with this agrees with the server. Surrounding
 * whitespace is ignored; thousands separators, currency symbols, exponents, a
 * leading `+` and a bare `.5` or `5.` are not accepted.
 *
 * There is no size limit: `bigint` is exact at any length, so totals larger
 * than a single column could hold still add up correctly.
 *
 * @param value - A plain decimal string such as `'-81.2'`, `'2850.0000'` or `'0'`.
 * @param label - What the value is, used in the error message. Defaults to `'amount'`.
 * @returns The amount scaled by 10,000. `'-0'` returns `0n` (a `bigint` has no negative zero).
 * @throws {RangeError} If `value` is not a string, not a plain decimal, or has more than four decimal places.
 * @example
 * moneyToUnits('-81.2') // -812_000n
 */
export function moneyToUnits(value: string, label = 'amount'): bigint {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!DECIMAL.test(text)) {
    const shown = typeof value === 'string' ? JSON.stringify(value) : `${typeof value} ${String(value)}`
    throw new RangeError(`Invalid ${label}: ${shown}`)
  }

  const negative = text.startsWith('-')
  const [whole = '0', fraction = ''] = (negative ? text.slice(1) : text).split('.')
  const units = BigInt(whole) * MONEY_UNIT + BigInt(fraction.padEnd(MONEY_SCALE, '0'))
  return negative ? -units : units
}
