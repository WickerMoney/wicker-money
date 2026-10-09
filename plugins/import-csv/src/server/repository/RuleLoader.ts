import type { Query, RuleForMatching } from '@wickermoney/plugin-sdk/server'

/** Reads and orders the user's category rules through the given query runner. */
export type RuleLoader = (q: Query) => Promise<readonly RuleForMatching[]>
