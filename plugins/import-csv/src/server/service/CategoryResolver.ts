import type { RuleForMatching } from '../repository/RuleForMatching.js'

/**
 * Picks the category id the given rules assign to a transaction.
 *
 * Supplied by the host so imported and hand-entered transactions share one
 * definition of what a rule matches.
 *
 * @returns The category id, or `null` when no rule matches.
 */
export type CategoryResolver = (
  rules: readonly RuleForMatching[],
  subject: { merchant: string; notes?: string | null; amount: string },
) => string | null
