import { money } from '../../money.js'
import type { CandidateTransactionRow } from '../repository/CandidateTransactionRow.js'
import type { ParsedCandidate } from './ParsedCandidate.js'

/**
 * Prepares transactions for ranking against any number of legs: each date is
 * parsed once, and each amount at most once, on first use.
 *
 * @param rows - Candidate transactions (any account, any date).
 * @returns One parsed candidate per row, in order.
 */
export function parseCandidates(rows: readonly CandidateTransactionRow[]): ParsedCandidate[] {
  return rows.map((row) => {
    let amount: ReturnType<typeof money> | undefined
    return {
      row,
      dateMs: Date.parse(`${row.transaction_date}T00:00:00Z`),
      amount: () => (amount ??= money(row.amount)),
    }
  })
}
