/**
 * Whether a decimal-string amount is above zero, without going through a
 * float: not negative, and some digit is not zero.
 *
 * @param amount - A decimal string such as `'200.0000'`.
 * @returns `true` for a positive amount.
 */
export function isPositiveAmount(amount: string): boolean {
  return !amount.trim().startsWith('-') && /[1-9]/.test(amount)
}
