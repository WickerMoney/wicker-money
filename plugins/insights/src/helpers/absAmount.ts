import { formatAmount } from './formatAmount.js'
import { parseAmount } from './parseAmount.js'

/**
 * @param value - A decimal string.
 * @returns The magnitude of the amount as a four-decimal string.
 * @throws {RangeError} If `value` is not a decimal number.
 */
export function absAmount(value: string): string {
  const units = parseAmount(value)
  return formatAmount(units < 0n ? -units : units)
}
