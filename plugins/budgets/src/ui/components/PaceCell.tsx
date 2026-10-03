import type { MonthLine } from '../models/index.js'
import { LineBar } from './LineBar.js'

/** Props for {@link PaceCell}. */
export interface PaceCellProps {
  readonly line: MonthLine
  /** The month being shown, `YYYY-MM`. */
  readonly monthKey: string
  /** Today's date, `YYYY-MM-DD`. */
  readonly today: string
  /** Formats a decimal-string amount for display. */
  readonly formatMoney: (value: string) => string
}

/** A line's spend against what it has available, as a bar with today marked on it. */
export function PaceCell({ line, monthKey, today, formatMoney }: PaceCellProps) {
  // A window's bar is the whole pot, with the mark at how far through the window today is.
  const label = line.window != null
    ? `${line.categoryName}: ${formatMoney(line.window.spentToDate)} of ${formatMoney(line.window.funded)} spent so far`
    : `${line.categoryName}: ${formatMoney(line.spent)} of ${formatMoney(line.available)}`
  return (
    <LineBar
      used={line.used}
      health={line.health}
      monthKey={monthKey}
      today={today}
      elapsed={line.window != null ? line.elapsed : undefined}
      label={label}
    />
  )
}
