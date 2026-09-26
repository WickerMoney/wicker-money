import type { RuleCondition } from '../../../models/index.js'

/**
 * The word for which side of zero an amount condition applies to.
 *
 * @param c - A saved condition.
 * @returns `"in"` for money coming in, otherwise `"out"`.
 */
export const directionWord = (c: RuleCondition): 'in' | 'out' => (c.direction === 'in' ? 'in' : 'out')
