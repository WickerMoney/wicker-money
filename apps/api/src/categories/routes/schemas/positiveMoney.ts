import { z } from 'zod'
import { isValidMoney, money, toMoney } from '../../../money.js'

/**
 * A strictly positive decimal amount.
 *
 * Accepts a numeric string or a number, and rejects anything lossy (more than
 * four decimal places) or not greater than zero. Parses to a canonical
 * decimal string.
 */
export const positiveMoney = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === 'number' ? v.toString() : v))
  .refine(isValidMoney, 'Must be a decimal with at most 4 decimal places.')
  .transform(toMoney)
  .refine((v) => money(v).greaterThan(0), 'Must be greater than zero.')
