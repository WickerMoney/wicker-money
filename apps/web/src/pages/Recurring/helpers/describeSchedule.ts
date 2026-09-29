import type { RecurringItem } from '../../../models/index.js'
import { FREQUENCY_LABELS } from './labels.js'
import { dayLabel } from './ordinal.js'

/**
 * A short, human description of when an item happens, for the list.
 *
 * Twice-a-month items name their days ("1st & 15th"), and a series that ends
 * says so. The anchor is never presented as a due date.
 *
 * @param item - The item.
 * @returns For example `Every 2 weeks`, `Twice a month · 15th & last day`, or `Monthly · until 2026-12-31`.
 */
export function describeSchedule(item: Pick<RecurringItem, 'frequency' | 'semimonthlyDays' | 'endDate'>): string {
  const parts: string[] = [FREQUENCY_LABELS[item.frequency]]
  if (item.frequency === 'semimonthly' && item.semimonthlyDays !== null) {
    parts.push(`${dayLabel(item.semimonthlyDays[0])} & ${dayLabel(item.semimonthlyDays[1])}`)
  }
  if (item.endDate !== null && item.frequency !== 'once') parts.push(`until ${item.endDate}`)
  return parts.join(' · ')
}
