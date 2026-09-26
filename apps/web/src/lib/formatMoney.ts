/** A decimal string split into sign and digit runs, ready for exact arithmetic. */
const DECIMAL = /^([+-])?(\d*)(?:\.(\d*))?$/

/**
 * Rounds a decimal magnitude half away from zero to a number of places, exactly.
 *
 * @param whole - The digits before the decimal point.
 * @param fraction - The digits after it (may be empty).
 * @param places - How many fraction digits to keep.
 * @returns The rounded integer part as a `bigint` and the kept fraction digits.
 */
function roundDecimal(
  whole: string, fraction: string, places: number,
): { readonly whole: bigint; readonly fraction: string } {
  const padded = fraction.padEnd(places + 1, '0')
  const kept = padded.slice(0, places)
  const roundUp = padded.charCodeAt(places) >= 53 // '5'
  const scaled = BigInt(`${whole === '' ? '0' : whole}${kept}`) + (roundUp ? 1n : 0n)
  const digits = scaled.toString().padStart(places + 1, '0')
  const split = digits.length - places
  return { whole: BigInt(digits.slice(0, split)), fraction: digits.slice(split) }
}

/**
 * Formats a decimal string as a localized currency amount, exactly.
 *
 * Monetary values travel as strings end to end and are never converted to
 * `number`: a double holds about 15 significant digits, so a large balance would
 * silently change its last digits. The whole part is grouped by `Intl` from a
 * `bigint`, and the fraction digits are taken from the string itself, rounded
 * half away from zero to the currency's own number of decimals.
 *
 * A value that is not a plain decimal (empty, exponent notation, garbage) falls
 * back to `Number`, which is what a malformed value deserves and no worse than
 * before.
 *
 * @param value - A decimal amount such as `"-12.50"`.
 * @param currency - ISO 4217 currency code. Defaults to `"USD"`.
 * @returns The amount formatted for the user's locale.
 * @throws {RangeError} When `currency` is not a well-formed currency code.
 */
export function formatMoney(value: string, currency = 'USD'): string {
  const formatter = new Intl.NumberFormat(undefined, { style: 'currency', currency })
  const match = DECIMAL.exec(value.trim())
  if (match === null || ((match[2] ?? '') === '' && (match[3] ?? '') === '')) {
    return formatter.format(Number(value))
  }

  const places = formatter.resolvedOptions().maximumFractionDigits ?? 2
  const rounded = roundDecimal(match[2] ?? '', match[3] ?? '', places)
  const negative = match[1] === '-' && (rounded.whole !== 0n || /[1-9]/.test(rounded.fraction))

  // Format the magnitude's whole part (exact for a bigint), keeping the sign
  // placement the locale chose. Negative zero has no bigint form, so -1 stands
  // in for it and its digit is swapped afterwards.
  const stand = negative && rounded.whole === 0n ? -1n : negative ? -rounded.whole : rounded.whole
  const zero = formatter.formatToParts(0n).find((p) => p.type === 'integer')?.value ?? '0'
  return formatter.formatToParts(stand).map((part) => {
    if (part.type === 'fraction') return rounded.fraction
    if (part.type === 'integer' && rounded.whole === 0n) return zero
    return part.value
  }).join('')
}
