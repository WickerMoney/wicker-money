import type { Described } from './Described.js'
import type { MatchCandidate } from './matchCandidates.js'

/** One leg of one occurrence that no transaction has settled yet. */
export interface OpenLeg extends Described {
  readonly accountId: string
  /** Expected signed amount on this account. */
  readonly amount: string
}

/** A candidate transaction for an open leg. */
export interface LegPair {
  readonly open: OpenLeg
  readonly candidate: MatchCandidate
}
