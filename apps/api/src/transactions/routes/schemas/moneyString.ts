import { z } from 'zod'
import { isValidMoney, toMoney } from '../../../money.js'

/**
 * A signed decimal amount of money.
 *
 * Accepts a numeric string or a number, rejects anything lossy (more than four
 * decimal places), and parses to a canonical decimal string. Unlike a
 * positive-only amount, zero and negative values are allowed, because a
 * transaction's sign records whether money left or entered the account.
 */
export const moneyString = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === 'number' ? v.toString() : v))
  .refine(isValidMoney, 'Enter an amount like 12.50, with no more than 4 decimal places.')
  .transform(toMoney)
