/**
 * Whether a decimal string is zero, by its text: `0`, `0.00`, `-0.0000`.
 *
 * @param value - A decimal string.
 * @returns `true` when every digit is zero.
 */
export function isZeroAmount(value: string): boolean {
  return /^[+-]?0*(\.0*)?$/.test(value.trim()) && /\d/.test(value)
}
