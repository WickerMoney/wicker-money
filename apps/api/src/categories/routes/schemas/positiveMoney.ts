import { z } from 'zod'
import { isValidMoney, money, toMoney } from '../../../money.js'

/**
 * A strictly positive decimal amount, refusing zero with the given sentence.
 *
 * Accepts a numeric string or a number, and rejects anything lossy (more than
 * four decimal places) or not greater than zero. Parses to a canonical
 * decimal string.
 *
 * @param notPositive - What to say when the amount is zero or negative. A
 *   bound that may be left out says so, so the person knows the way out.
 * @returns The schema.
 */
export function positiveMoneyWith(notPositive: string) {
  return z
    .union([z.string(), z.number()])
    .transform((v) => (typeof v === 'number' ? v.toString() : v))
    .refine(isValidMoney, 'Enter an amount like 12.50, with no more than 4 decimal places.')
    .transform(toMoney)
    .refine((v) => money(v).greaterThan(0), notPositive)
}

/** A strictly positive decimal amount. See {@link positiveMoneyWith}. */
export const positiveMoney = positiveMoneyWith('Must be more than 0.')
