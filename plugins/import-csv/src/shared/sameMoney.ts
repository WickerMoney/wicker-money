import { normalizeMoney } from './normalizeMoney.js'

/**
 * Compares two fixed-point money strings by value.
 *
 * @param a - A decimal string.
 * @param b - A decimal string.
 * @returns `true` when both normalise to the same amount, so `-81.2000` equals `-81.20`.
 */
export function sameMoney(a: string, b: string): boolean {
  return normalizeMoney(a) === normalizeMoney(b)
}
