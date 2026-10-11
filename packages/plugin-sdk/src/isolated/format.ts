const DECIMAL = /^([+-])?(\d*)(?:\.(\d*))?$/
const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

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
 * Formats a decimal string as a currency amount in `locale`, exactly.
 *
 * The same algorithm as the host's own `ctx.formatMoney`: the whole part is
 * grouped by `Intl` from a `bigint` and the fraction is taken from the string
 * and rounded half away from zero, so no value passes through a `number`. A
 * value that is not a plain decimal falls back to `Number`.
 *
 * @param locale - A BCP 47 tag, or `undefined` for the runtime's default.
 * @param value - A decimal amount such as `"-12.50"`.
 * @param currency - ISO 4217 code. Defaults to `"USD"`.
 * @returns The formatted amount.
 * @throws {RangeError} When `currency` is not a well-formed currency code.
 */
export function formatMoneyIn(locale: string | undefined, value: string, currency = 'USD'): string {
  const formatter = new Intl.NumberFormat(locale, { style: 'currency', currency })
  const match = DECIMAL.exec(value.trim())
  if (match === null || ((match[2] ?? '') === '' && (match[3] ?? '') === '')) {
    return formatter.format(Number(value))
  }
  const places = formatter.resolvedOptions().maximumFractionDigits ?? 2
  const rounded = roundDecimal(match[2] ?? '', match[3] ?? '', places)
  const negative = match[1] === '-' && (rounded.whole !== 0n || /[1-9]/.test(rounded.fraction))
  const stand = negative && rounded.whole === 0n ? -1n : negative ? -rounded.whole : rounded.whole
  const zero = formatter.formatToParts(0n).find((p) => p.type === 'integer')?.value ?? '0'
  return formatter.formatToParts(stand).map((part) => {
    if (part.type === 'fraction') return rounded.fraction
    if (part.type === 'integer' && rounded.whole === 0n) return zero
    return part.value
  }).join('')
}

/**
 * Formats a date in `locale`. A calendar date (`YYYY-MM-DD`) is shown as that
 * day whatever the time zone, exactly as the host's `ctx.formatDate` does.
 *
 * @param locale - A BCP 47 tag, or `undefined` for the runtime's default.
 * @param value - `YYYY-MM-DD`, or any string `Date` accepts.
 * @returns The locale's short date.
 */
export function formatDateIn(locale: string | undefined, value: string): string {
  const match = CALENDAR_DATE.exec(value)
  if (match === null) return new Date(value).toLocaleDateString(locale)
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).toLocaleDateString(locale)
}
