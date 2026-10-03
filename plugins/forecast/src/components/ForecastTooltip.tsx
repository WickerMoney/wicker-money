import type { ForecastEntry } from '../models/index.js'

/** Props for {@link ForecastTooltip}. */
export interface ForecastTooltipProps {
  readonly date: string
  readonly isToday: boolean
  readonly balance: string
  readonly low: string
  /** What lands that day. */
  readonly entries: readonly ForecastEntry[]
  /** Horizontal position as a percentage of the chart width. */
  readonly leftPercent: number
  readonly formatMoney: (value: string) => string
  readonly formatDate: (value: string) => string
}

/**
 * The readout for the hovered or focused day: its end balance, its low when
 * the day dips below that, and what lands on it. Announced politely, so a
 * keyboard user stepping through days hears each one.
 */
export function ForecastTooltip({
  date, isToday, balance, low, entries, leftPercent, formatMoney, formatDate,
}: ForecastTooltipProps) {
  // Keep the box inside the chart near either edge.
  const shift = leftPercent > 70 ? '-100%' : leftPercent < 30 ? '0' : '-50%'
  return (
    <div className="fc-tip" style={{ left: `${leftPercent}%`, transform: `translateX(${shift})` }} aria-live="polite">
      <span className="fc-tip__date">{isToday ? `Today, ${formatDate(date)}` : formatDate(date)}</span>
      <span className="fc-tip__row">{isToday ? 'Balance now' : 'End of day'} <strong>{formatMoney(balance)}</strong></span>
      {low !== balance ? (
        <span className="fc-tip__row fc-tip__low">Dips to <strong>{formatMoney(low)}</strong> before money arrives</span>
      ) : null}
      {entries.map((e) => (
        <span key={e.itemId} className="fc-tip__row fc-tip__entry">
          {e.name} <span className={e.kind === 'transfer' ? '' : e.amount.startsWith('-') ? 'fc-neg' : 'fc-pos'}>{formatMoney(e.amount)}</span>
        </span>
      ))}
    </div>
  )
}
