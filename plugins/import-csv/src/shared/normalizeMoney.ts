/**
 * Strips the trailing zeros `numeric(19,4)` adds, as text.
 *
 * PostgreSQL returns `-81.2000` for an amount that parses from a CSV as
 * `-81.20`, and comparing those as strings is false, which would make every
 * row look new and disable heuristic duplicate detection. Normalising as text
 * fixes that without a float. It is also used when writing an amount into a
 * message a person reads, where `-81.2000` looks like a different number than
 * the one on their statement.
 *
 * @param v - A decimal string, optionally negative.
 * @returns The string without leading zeros in the whole part or trailing
 *   zeros in the fraction; negative zero becomes `0`.
 */
export function normalizeMoney(v: string): string {
  const negative = v.startsWith('-')
  const digits = negative ? v.slice(1) : v
  const [whole = '0', fraction = ''] = digits.split('.')
  const trimmedWhole = whole.replace(/^0+(?=\d)/, '') || '0'
  const trimmedFraction = fraction.replace(/0+$/, '')
  const body = trimmedFraction === '' ? trimmedWhole : `${trimmedWhole}.${trimmedFraction}`
  // -0 and 0 are the same amount.
  return negative && !/^0(\.0*)?$/.test(body) ? `-${body}` : body
}
