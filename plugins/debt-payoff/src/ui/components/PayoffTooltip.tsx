import type { MonthReadout } from '../models/index.js'

/** Props for {@link PayoffTooltip}. */
export interface PayoffTooltipProps {
  readonly readout: MonthReadout
  /** The point's position across the plot, 0 to 100. */
  readonly leftPercent: number
  readonly formatDate: (value: string) => string
}

/**
 * The readout beside the pointer or the keyboard cursor: the month, the total
 * still owed, and each debt's balance with its colour next to its name.
 *
 * Pointer-transparent, so it never gets between the pointer and the chart.
 * Screen readers get the same month from the chart's live region instead.
 */
export function PayoffTooltip({ readout, leftPercent, formatDate }: PayoffTooltipProps) {
  const flip = leftPercent > 60
  return (
    <div
      className="dp-tip"
      aria-hidden="true"
      style={flip ? { right: `${100 - leftPercent}%` } : { left: `${leftPercent}%` }}
    >
      <div className="dp-tip__date">{readout.paid === null ? `Today, ${formatDate(readout.date)}` : formatDate(readout.date)}</div>
      <div>{readout.total} owed</div>
      {readout.rows.map((r) => (
        <div className="dp-tip__row" key={r.name}>
          <span className="dp-swatch" style={{ background: r.color }} />
          <span>{r.name}</span>
          <strong>{r.balance}</strong>
        </div>
      ))}
      {readout.clearedNames.length > 0 ? <div className="dp-tip__done">Paid off: {readout.clearedNames.join(', ')}</div> : null}
    </div>
  )
}
