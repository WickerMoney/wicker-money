import type { Query } from './Query.js'
import type { RuleForMatching } from './RuleForMatching.js'

/** Reads and orders the user's category rules through the given query runner. */
export type RuleLoader = (q: Query) => Promise<readonly RuleForMatching[]>
