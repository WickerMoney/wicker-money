import type { MatchSuggestion } from './MatchSuggestion.js'
import type { LegPair } from './OpenLeg.js'
import { toOccurrenceView } from './toOccurrenceView.js'

/**
 * Chooses the suggestions from every confident, undismissed candidate pair.
 *
 * Pairs are taken best first (lowest score; equal scores keep their input
 * order), and a pair is skipped when its transaction or its leg (item,
 * nominal date and account) was already taken by a better one. So each
 * transaction and each leg appears at most once.
 *
 * @param pairs - Candidate pairs in any order. Not modified.
 * @returns The suggestions, best first.
 */
export function assignSuggestions(pairs: readonly LegPair[]): MatchSuggestion[] {
  const ranked = [...pairs].sort((a, b) => a.candidate.score - b.candidate.score)
  const usedTransactions = new Set<string>()
  const usedLegs = new Set<string>()
  const suggestions: MatchSuggestion[] = []
  for (const { open: o, candidate } of ranked) {
    const leg = `${o.row.id}|${o.state.nominalDate}|${o.accountId}`
    if (usedTransactions.has(candidate.transactionId) || usedLegs.has(leg)) continue
    usedTransactions.add(candidate.transactionId)
    usedLegs.add(leg)
    suggestions.push({ occurrence: toOccurrenceView(o.row, o.state, o.state.expectedDate), accountId: o.accountId, candidate })
  }
  return suggestions
}
