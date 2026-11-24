import type { LumpSumOutcome } from '../../shared/index.js'

/**
 * What the plan did with a lump sum, as a sentence the page shows beside it.
 *
 * @param outcome - The plan's report for the lump sum, or `undefined` before a plan has loaded.
 * @param formatMoney - Formats an amount.
 * @param formatDate - Formats a date.
 */
export function lumpSumStatus(
  outcome: LumpSumOutcome | undefined,
  formatMoney: (value: string) => string,
  formatDate: (value: string) => string,
): string {
  if (outcome === undefined) return '…'
  if (outcome.status === 'past') return 'The date has passed, so the plan ignores it. Your balances already include it.'
  if (outcome.status === 'beyond_limit') return 'This is after the plan ends, so the plan ignores it.'
  const date = outcome.date === null ? '' : ` on ${formatDate(outcome.date)}`
  if (Number(outcome.paid) === 0) return 'Not needed: every debt is paid off or not yet due by then.'
  if (Number(outcome.unused) > 0) {
    return `Paid${date}: ${formatMoney(outcome.paid)} used, ${formatMoney(outcome.unused)} not needed because every debt is paid off or not yet due.`
  }
  return `Paid${date} in the plan.`
}
