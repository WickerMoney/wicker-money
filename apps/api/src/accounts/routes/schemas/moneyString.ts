import { z } from 'zod'
import { isValidMoney, toMoney } from '../../../money.js'

/**
 * A decimal money amount, positive, zero or negative.
 *
 * Accepts a numeric string or a number, rejects anything lossy (more than four
 * decimal places), and parses to a canonical decimal string.
 */
export const moneyString = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === 'number' ? v.toString() : v))
  .refine(isValidMoney, 'Enter an amount like 12.50, with no more than 4 decimal places.')
  .transform(toMoney)
