/**
 * Fixed-point money, as text.
 *
 * `numeric(19,4)` comes out of PostgreSQL as a string and goes back in as one.
 * The temptation at every step is to `Number()` it for a moment — to sum a
 * column, to compare against a plan, to work out a percentage — and each of
 * those moments is where a budget stops reconciling with the ledger by a cent
 * that nobody can find afterwards.
 *
 * So the arithmetic happens in `bigint` at four decimal places and the values
 * stay strings at every boundary. The one function that returns a `number` is
 * `ratio`, which exists to drive a progress bar: a bar is pixels, a rounding
 * error in it is invisible, and nothing downstream of it is money.
 *
 * Small enough to live here rather than pull a decimal library in. If a third
 * consumer appears it belongs in the SDK, not copied a third time.
 */

const SCALE = 4n
const UNIT = 10_000n

const NUMERIC = /^-?\d+(\.\d+)?$/

/**
 * Parses a decimal string such as `'-81.2000'`, `'81.2'` or `'0'` into
 * integer units of 1/10,000.
 *
 * @param value - A plain decimal string, optionally negative, with any number of fraction digits.
 * @returns The amount scaled by 10,000 (fractions beyond four places are truncated).
 * @throws {RangeError} If `value` is not a plain decimal number.
 */
export function parseMoney(value: string): bigint {
  const text = value.trim()
  if (!NUMERIC.test(text)) throw new RangeError(`Not an amount: ${value}`)

  const negative = text.startsWith('-')
  const digits = negative ? text.slice(1) : text
  const [whole = '0', fraction = ''] = digits.split('.')
  // Pad or truncate to exactly four places. Truncation rather than rounding is
  // deliberate: the column holds four places, so a fifth cannot have come from
  // the database, and silently rounding an input the user typed would change
  // the number they entered.
  const scaled = (fraction + '0000').slice(0, Number(SCALE))
  const units = BigInt(whole) * UNIT + BigInt(scaled)
  return negative ? -units : units
}

/**
 * Formats integer units of 1/10,000 as the four-decimal string the database column uses.
 *
 * @param units - An amount scaled by 10,000.
 * @returns A string such as `'-81.2000'`.
 */
export function formatMoney(units: bigint): string {
  const negative = units < 0n
  const absolute = negative ? -units : units
  const whole = absolute / UNIT
  const fraction = (absolute % UNIT).toString().padStart(Number(SCALE), '0')
  return `${negative ? '-' : ''}${whole}.${fraction}`
}

/**
 * Adds two amounts exactly.
 *
 * @param a - First amount as a decimal string.
 * @param b - Second amount as a decimal string.
 * @returns `a + b` as a four-decimal string.
 * @throws {RangeError} If either argument is not a decimal number.
 */
export function addMoney(a: string, b: string): string {
  return formatMoney(parseMoney(a) + parseMoney(b))
}

/**
 * Subtracts one amount from another exactly.
 *
 * @param a - Amount to subtract from, as a decimal string.
 * @param b - Amount to subtract, as a decimal string.
 * @returns `a - b` as a four-decimal string.
 * @throws {RangeError} If either argument is not a decimal number.
 */
export function subtractMoney(a: string, b: string): string {
  return formatMoney(parseMoney(a) - parseMoney(b))
}

/**
 * Totals a list of amounts exactly.
 *
 * @param values - Decimal strings to add; may be empty.
 * @returns The total as a four-decimal string (`'0.0000'` for an empty list).
 * @throws {RangeError} If any element is not a decimal number.
 */
export function sumMoney(values: readonly string[]): string {
  return formatMoney(values.reduce((total, v) => total + parseMoney(v), 0n))
}

/**
 * Flips the sign of an amount.
 *
 * @param value - A decimal string.
 * @returns `-value` as a four-decimal string.
 * @throws {RangeError} If `value` is not a decimal number.
 */
export function negateMoney(value: string): string {
  return formatMoney(-parseMoney(value))
}

/**
 * Orders two amounts numerically.
 *
 * @param a - First amount as a decimal string.
 * @param b - Second amount as a decimal string.
 * @returns `-1` if `a < b`, `1` if `a > b`, otherwise `0`.
 * @throws {RangeError} If either argument is not a decimal number.
 */
export function compareMoney(a: string, b: string): -1 | 0 | 1 {
  const x = parseMoney(a)
  const y = parseMoney(b)
  return x < y ? -1 : x > y ? 1 : 0
}

/**
 * Tests whether an amount is below zero.
 *
 * @param value - A decimal string.
 * @returns `true` if `value` is strictly negative.
 * @throws {RangeError} If `value` is not a decimal number.
 */
export function isNegative(value: string): boolean {
  return parseMoney(value) < 0n
}

/**
 * Tests whether an amount is exactly zero.
 *
 * @param value - A decimal string.
 * @returns `true` if `value` equals zero at four decimal places.
 * @throws {RangeError} If `value` is not a decimal number.
 */
export function isZero(value: string): boolean {
  return parseMoney(value) === 0n
}

/**
 * The shape a person types, not the shape the column stores.
 *
 * `numeric(19,4)` round-trips as `450.0000`, and putting that in an editable
 * field tells the user the database's business rather than their own — nobody
 * types four decimal places for a grocery budget. Trailing zeros are trimmed as
 * text, never by parsing to a float, and two places are kept because that is
 * what money looks like.
 *
 * @param value - A stored amount as a decimal string.
 * @returns A string with two decimals, or four when the value has real sub-cent precision.
 * @throws {RangeError} If `value` is not a decimal number.
 */
export function editableMoney(value: string): string {
  const units = parseMoney(value)
  const negative = units < 0n
  const absolute = negative ? -units : units
  const whole = absolute / UNIT
  const cents = (absolute % UNIT) / 100n
  const remainder = absolute % 100n
  // A value with real sub-cent precision keeps all four places rather than
  // being silently rounded into something the user never entered.
  if (remainder !== 0n) return formatMoney(units)
  return `${negative ? '-' : ''}${whole}.${cents.toString().padStart(2, '0')}`
}

/**
 * `spent / planned`, as a float, for progress bars only.
 *
 * A zero plan has no meaningful ratio. Returning 0 would draw an empty bar for
 * a category that has been overspent against a plan of nothing, which is the
 * opposite of the truth, so a zero plan with any spend is reported as fully
 * over.
 *
 * @param spent - Amount spent, as a decimal string.
 * @param planned - Amount planned, as a decimal string.
 * @returns `spent / planned`; `0` when both are zero, `1` when only the plan is zero.
 * @throws {RangeError} If either argument is not a decimal number.
 */
export function ratio(spent: string, planned: string): number {
  const p = parseMoney(planned)
  const s = parseMoney(spent)
  if (p === 0n) return s === 0n ? 0 : 1
  return Number(s) / Number(p)
}
