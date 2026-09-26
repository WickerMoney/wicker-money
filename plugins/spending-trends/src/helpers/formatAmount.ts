import { AMOUNT_UNIT } from './AMOUNT_UNIT.js'

/**
 * Formats integer units of 1/10,000 as a four-decimal string.
 *
 * @param units - An amount scaled by 10,000.
 * @returns A string such as `'-81.2000'`.
 */
export function formatAmount(units: bigint): string {
  const negative = units < 0n
  const absolute = negative ? -units : units
  const fraction = (absolute % AMOUNT_UNIT).toString().padStart(4, '0')
  return `${negative ? '-' : ''}${absolute / AMOUNT_UNIT}.${fraction}`
}
