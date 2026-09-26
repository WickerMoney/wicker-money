import { Decimal } from 'decimal.js'

/**
 * Monetary values are `numeric(19,4)` in Postgres and `string` in TypeScript.
 *
 * They are never `number`: an IEEE-754 double cannot hold that range and scale
 * without silent precision loss, and financial arithmetic that is subtly wrong
 * is worse than arithmetic that fails. Arithmetic goes through `decimal.js`
 * (see {@link money}); values are formatted back to strings at four decimal
 * places.
 */
export type Money = string

/** Number of decimal places stored (the scale of `numeric(19,4)`). */
const SCALE = 4

const INVALID_AMOUNT = 'Amount must be a decimal string with at most 4 decimal places.'

// 34 significant digits, half-up rounding, applied globally to Decimal.
Decimal.set({ precision: 34, rounding: Decimal.ROUND_HALF_UP })

/**
 * Wraps a monetary value as an arbitrary-precision `Decimal` for arithmetic and
 * comparison.
 *
 * @param value - Decimal string (preferred) or number.
 * @returns A `Decimal` holding exactly that value.
 * @throws {Error} If `value` is not a valid decimal (from `decimal.js`).
 * @example
 * money('10.10').plus(money('0.20')).toFixed(4) // '10.3000'
 */
export function money(value: Money | number): Decimal {
  return new Decimal(value)
}

/**
 * Normalises a value to the storage scale (four decimal places, half-up).
 *
 * A value that rounds to zero is returned as `'0.0000'`, never `'-0.0000'`:
 * the stored column has no negative zero, and a signed zero string would
 * compare unequal to the zero it stands for.
 *
 * @param value - `Decimal`, decimal string or number.
 * @returns A fixed-point string such as `'12.5000'`.
 */
export function toMoney(value: Decimal | Money | number): Money {
  const fixed = new Decimal(value).toFixed(SCALE)
  return fixed.startsWith('-') && new Decimal(fixed).isZero() ? fixed.slice(1) : fixed
}

/**
 * Sums any number of monetary values exactly.
 *
 * @param values - Amounts to add; an empty list sums to zero.
 * @returns The total at the storage scale.
 * @example
 * addMoney('0.1', '0.2') // '0.3000'
 */
export function addMoney(...values: readonly (Money | number)[]): Money {
  return toMoney(values.reduce<Decimal>((sum, v) => sum.plus(v), new Decimal(0)))
}

/**
 * Flips the sign, at the storage scale.
 *
 * Used to derive a transfer's outgoing leg from its incoming one. Doing it
 * through Decimal rather than string surgery means `-0.0000` never appears:
 * negating zero gives zero, where prefixing a minus would produce a value that
 * compares unequal to the one it came from.
 *
 * @param value - Amount to negate.
 * @returns The negated amount at the storage scale.
 */
export function negate(value: Money | number): Money {
  return toMoney(new Decimal(value).negated())
}

/**
 * Whether a string is an acceptable monetary literal: optional minus sign, 1 to
 * 15 integer digits, and at most 4 decimal places (matching `numeric(19,4)`).
 * Exponent notation and surrounding whitespace are rejected.
 *
 * @param value - Candidate string.
 * @returns True if `value` can be stored losslessly.
 */
export function isValidMoney(value: string): boolean {
  if (!/^-?\d{1,15}(\.\d{1,4})?$/.test(value)) return false
  return !new Decimal(value).isNaN()
}

/**
 * Zod-friendly parser: accepts a valid decimal string or a finite number and
 * rejects anything that could lose precision.
 *
 * A number is judged by its shortest round-trip decimal form, so `0.1` is
 * accepted while `1.23456` (five places) or `1e-7` is refused rather than
 * silently rounded.
 *
 * @param value - Untrusted input.
 * @returns The value at the storage scale.
 * @throws {Error} If the value is a non-finite number, or a number or string
 * that does not satisfy {@link isValidMoney}.
 */
export function parseMoney(value: unknown): Money {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Amount must be finite.')
    // `toFixed()` with no argument expands exponent notation without rounding.
    const text = new Decimal(value).toFixed()
    if (!isValidMoney(text)) throw new Error(INVALID_AMOUNT)
    return toMoney(text)
  }
  if (typeof value !== 'string' || !isValidMoney(value)) throw new Error(INVALID_AMOUNT)
  return toMoney(value)
}
