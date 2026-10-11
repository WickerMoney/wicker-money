import type { MonthReadout } from '../models/index.js'

/**
 * A month as one sentence for a screen reader, announced as the reader moves
 * along the chart.
 *
 * @param readout - The month.
 * @param formatDate - The host's date formatter.
 */
export function describeMonth(readout: MonthReadout, formatDate: (value: string) => string): string {
  const when = readout.paid === null ? `Today, ${formatDate(readout.date)}` : formatDate(readout.date)
  const parts = [`${when}: ${readout.total} still owed.`]
  if (readout.paid !== null && readout.interest !== null) {
    parts.push(`${readout.paid} paid; ${readout.interest} of interest added.`)
  }
  if (readout.clearedNames.length > 0) parts.push(`Paid off: ${readout.clearedNames.join(', ')}.`)
  return parts.join(' ')
}
