import type { RuleCondition } from '../../../models/index.js'

/**
 * The note appended to a text condition when its match respects letter case.
 *
 * @param c - A saved condition.
 * @returns `" (case-sensitive)"` or an empty string.
 */
export const caseSuffix = (c: RuleCondition): string => (c.is_case_sensitive ? ' (case-sensitive)' : '')
