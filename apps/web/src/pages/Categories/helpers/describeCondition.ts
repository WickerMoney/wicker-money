import type { RuleCondition } from '../../../models/index.js'
import { CONDITION_DESCRIBERS } from './conditionDescribers.js'

/**
 * Describes a saved condition in plain words.
 *
 * @param c - The condition as returned by the API.
 * @returns A sentence fragment such as `Merchant contains 'COFFEE'`.
 */
export function describeCondition(c: RuleCondition): string {
  // A type the server adds before this build knows it still renders, as its name.
  const describe = CONDITION_DESCRIBERS[c.condition_type] as ((c: RuleCondition) => string) | undefined
  return describe?.(c) ?? c.condition_type
}
