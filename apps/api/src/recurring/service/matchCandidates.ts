import { money } from '../../money.js'
import type { CandidateTransactionRow } from '../repository/CandidateTransactionRow.js'

/** How far either side of an occurrence's expected date a transaction can be offered as its match. */
export const MATCH_WINDOW_DAYS = 10

/**
 * The closest a candidate must be to be suggested without being asked for:
 * within this many days of the expected date...
 */
export const SUGGEST_DAYS = 5
/** ...and within this fraction of the expected amount (a utility bill that varies a little still qualifies). */
export const SUGGEST_AMOUNT_TOLERANCE = '0.25'

/** A transaction that could settle one leg of one occurrence. */
export interface MatchCandidate {
  readonly transactionId: string
  readonly date: string
  /** What posted, signed. */
  readonly amount: string
  readonly merchant: string
  /** Days from the expected date: negative is early, positive late. */
  readonly dayDifference: number
  /** What posted minus what was expected, signed, four decimals. */
  readonly amountDifference: string
  /** Close enough in date and amount to suggest unprompted. */
  readonly confident: boolean
  /** Ranking key, lower is better. Not money: a blend of days and relative amount difference. */
  readonly score: number
}

/**
 * Ranks the transactions that could settle one leg.
 *
 * A candidate is on the leg's account, has the leg's sign (money out for a
 * bill, in for a paycheck), is not already settling another occurrence, and
 * posted within {@link MATCH_WINDOW_DAYS} of the expected date. Ranking
 * weighs a day's distance against a tenth of the amount: a payment exactly
 * on the amount two days late beats one 30% off on the day.
 *
 * @param leg - The leg: its account and expected signed amount.
 * @param expectedDate - When the occurrence is expected.
 * @param rows - Transactions to choose from (any account, any date).
 * @param occurrenceId - The occurrence's own row, if it has one: transactions already on it stay candidates.
 * @returns Candidates, best first.
 */
export function rankCandidates(
  leg: { readonly accountId: string; readonly amount: string },
  expectedDate: string,
  rows: readonly CandidateTransactionRow[],
  occurrenceId: string | null = null,
): MatchCandidate[] {
  const expected = money(leg.amount)
  const negative = expected.isNegative()
  const found: MatchCandidate[] = []
  for (const row of rows) {
    if (row.account_id !== leg.accountId) continue
    if (row.recurring_occurrence_id !== null && row.recurring_occurrence_id !== occurrenceId) continue
    const actual = money(row.amount)
    if (actual.isZero() || actual.isNegative() !== negative) continue
    const dayDifference = daysBetween(expectedDate, row.transaction_date)
    if (Math.abs(dayDifference) > MATCH_WINDOW_DAYS) continue

    const difference = actual.minus(expected)
    const relative = difference.abs().dividedBy(expected.abs())
    found.push({
      transactionId: row.id,
      date: row.transaction_date,
      amount: row.amount,
      merchant: row.merchant,
      dayDifference,
      amountDifference: difference.toFixed(4),
      confident: Math.abs(dayDifference) <= SUGGEST_DAYS && relative.lessThanOrEqualTo(SUGGEST_AMOUNT_TOLERANCE),
      score: Math.abs(dayDifference) + relative.times(10).toNumber(),
    })
  }
  return found.sort((a, b) => a.score - b.score || compare(a.date, b.date) || compare(a.transactionId, b.transactionId))
}

/** Whole days from `a` to `b`, both `YYYY-MM-DD`. */
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}

/** String order. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
