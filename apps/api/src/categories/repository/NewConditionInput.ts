import type { MatchCondition } from '../engine.js'

/** A rule condition to insert: the matchable columns plus the ids that own it. */
export type NewConditionInput = MatchCondition & { readonly userId: string; readonly ruleId: string }
