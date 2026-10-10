import type { CandidateTransactionRow } from '../repository/CandidateTransactionRow.js'
import { rankCandidates } from './matchCandidates.js'
import type { LegPair, OpenLeg } from './OpenLeg.js'
import { pairKey } from './pairKey.js'

/**
 * Pairs each open leg with the transactions confident enough to suggest for
 * it, leaving out pairs the user dismissed.
 *
 * @param open - Unsettled legs.
 * @param rows - Candidate transactions (any account, any date).
 * @param dismissedPairs - Dismissed pairs, by {@link pairKey}.
 * @returns The pairs, grouped by leg in `open` order and best candidate first within a leg.
 */
export function confidentPairs(
  open: readonly OpenLeg[],
  rows: readonly CandidateTransactionRow[],
  dismissedPairs: ReadonlySet<string>,
): LegPair[] {
  const pairs: LegPair[] = []
  for (const o of open) {
    for (const candidate of rankCandidates(o, o.state.expectedDate, rows)) {
      if (!candidate.confident) continue
      if (dismissedPairs.has(pairKey(candidate.transactionId, o.row.id, o.state.nominalDate))) continue
      pairs.push({ open: o, candidate })
    }
  }
  return pairs
}
