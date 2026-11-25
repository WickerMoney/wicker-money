import type { WhatIfResult } from '../../shared/index.js'
import { durationText } from './durationText.js'

/**
 * What a what-if found, as one plain sentence that the page shows and its live
 * region announces, so neither depends on colour or a chart.
 *
 * @param result - The server's answer.
 * @param formatMoney - Formats an amount.
 * @param formatDate - Formats a date.
 */
export function whatIfSentence(
  result: WhatIfResult,
  formatMoney: (value: string) => string,
  formatDate: (value: string) => string,
): string {
  const { lumpSum, current, withLumpSum, interestSaved, monthsSaved } = result
  if (lumpSum.status === 'past') return 'That date has passed, so the plan would ignore it and nothing would change.'
  if (lumpSum.status === 'beyond_limit') return 'That date is after the plan ends, so nothing would change.'
  const unused = Number(lumpSum.unused) > 0
    ? ` ${formatMoney(lumpSum.unused)} of it would not be needed, because every debt is paid off or not yet due by then.`
    : ''
  if (withLumpSum.debtFreeDate === null) {
    return `Even with ${formatMoney(lumpSum.amount)} on ${formatDate(lumpSum.onDate)} the plan does not reach zero within its limit.${unused}`
  }
  const when = `${formatDate(withLumpSum.debtFreeDate)}, ${durationText(withLumpSum.months)} from now`
  if (current.debtFreeDate === null || interestSaved === null || monthsSaved === null) {
    return `With ${formatMoney(lumpSum.amount)} on ${formatDate(lumpSum.onDate)} you would be debt free on ${when}. Without it the plan does not reach zero within its limit.${unused}`
  }
  const sooner = monthsSaved > 0 ? `${durationText(monthsSaved)} sooner` : 'the same date'
  const saved = Number(interestSaved) > 0 ? `saving ${formatMoney(interestSaved)} in interest` : 'saving no interest'
  return `With ${formatMoney(lumpSum.amount)} on ${formatDate(lumpSum.onDate)} you would be debt free on ${when}: ${sooner}, ${saved}.${unused}`
}
