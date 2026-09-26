import type { RuleCondition } from '../../../models/index.js'
import { directionWord } from './directionWord.js'

/**
 * Describes an amount-range condition, which may have one bound, both or neither.
 *
 * @param c - A saved condition of type `amount_range`.
 * @returns A sentence fragment such as `Amount out between 10 and 20`.
 */
export function describeAmountRange(c: RuleCondition): string {
  const dir = directionWord(c)
  if (c.amount_min !== null && c.amount_max !== null) {
    return `Amount ${dir} between ${c.amount_min} and ${c.amount_max}`
  }
  if (c.amount_min !== null) return `Amount ${dir}, at least ${c.amount_min}`
  if (c.amount_max !== null) return `Amount ${dir}, at most ${c.amount_max}`
  return `Amount ${dir} (range)`
}
