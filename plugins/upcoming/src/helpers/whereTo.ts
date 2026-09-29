import type { UpcomingOccurrence } from '../models/index.js'

/**
 * Where an occurrence's money goes, in words: the paying account for a bill,
 * `A + B` for a split paycheck, and `A → B` for a transfer or debt payment.
 *
 * @param occurrence - The occurrence.
 * @param accountName - Looks up an account's name.
 * @returns The description.
 */
export function whereTo(occurrence: UpcomingOccurrence, accountName: (id: string) => string): string {
  if (occurrence.kind === 'transfer' || occurrence.kind === 'debt_payment') {
    const from = occurrence.legs.find((l) => l.amount.startsWith('-'))
    const to = occurrence.legs.find((l) => !l.amount.startsWith('-'))
    return `${from === undefined ? '?' : accountName(from.accountId)} → ${to === undefined ? '?' : accountName(to.accountId)}`
  }
  return occurrence.legs.map((l) => accountName(l.accountId)).join(' + ')
}
