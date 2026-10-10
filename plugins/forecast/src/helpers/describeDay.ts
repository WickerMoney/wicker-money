import type { ForecastEntry } from '../models/index.js'

/** What {@link describeDay} reads back. */
export interface DayReadout {
  readonly date: string
  readonly isToday: boolean
  readonly balance: string
  readonly low: string
  /** What lands that day. */
  readonly entries: readonly ForecastEntry[]
  readonly formatMoney: (value: string) => string
  readonly formatDate: (value: string) => string
}

/**
 * One day of the forecast as a sentence, for the chart's live region. It says
 * what the tooltip shows, in the same order.
 *
 * @param day - The day's figures and the formatters.
 * @returns For example `"Oct 4. End of day $900. Dips to $-100 before money arrives. Rent $-500."`
 */
export function describeDay({ date, isToday, balance, low, entries, formatMoney, formatDate }: DayReadout): string {
  const parts = [
    isToday ? `Today, ${formatDate(date)}.` : `${formatDate(date)}.`,
    `${isToday ? 'Balance now' : 'End of day'} ${formatMoney(balance)}.`,
  ]
  if (low !== balance) parts.push(`Dips to ${formatMoney(low)} before money arrives.`)
  for (const e of entries) parts.push(`${e.name} ${formatMoney(e.amount)}.`)
  return parts.join(' ')
}
