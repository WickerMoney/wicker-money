import type { OccurrenceStatus, RecurringKind } from '../../../models/index.js'

/** How a status reads beside an occurrence, and whether it needs attention. */
export interface StatusLabel {
  readonly text: string
  readonly tone: 'muted' | 'good' | 'warn'
}

/**
 * Words for an occurrence's status. Money in "arrived"; money out is "paid".
 *
 * @param status - The status.
 * @param kind - The item's kind.
 * @returns The label.
 */
export function statusLabel(status: OccurrenceStatus, kind: RecurringKind): StatusLabel {
  switch (status) {
    case 'cleared': return { text: kind === 'income' ? 'Arrived' : kind === 'bill' || kind === 'debt_payment' ? 'Paid' : 'Moved', tone: 'good' }
    case 'skipped': return { text: 'Skipped', tone: 'muted' }
    case 'due': return { text: 'Due today', tone: 'warn' }
    case 'late': return { text: 'Late', tone: 'warn' }
    case 'missed': return { text: 'Missed', tone: 'muted' }
    case 'assumed': return { text: 'Past', tone: 'muted' }
    case 'upcoming': return { text: 'Upcoming', tone: 'muted' }
  }
}

/**
 * A day difference in words: "on the day", "2 days early", "1 day late".
 *
 * @param days - Days from the expected date; negative is early.
 * @returns The phrase.
 */
export function dayDifferenceText(days: number): string {
  if (days === 0) return 'on the day'
  const n = Math.abs(days)
  return `${n} day${n === 1 ? '' : 's'} ${days < 0 ? 'early' : 'late'}`
}
