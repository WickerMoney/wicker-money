import { isNegativeAmount } from '../helpers/isNegativeAmount.js'
import { monthLabelLong } from '../helpers/monthLabelLong.js'
import type { MonthReadout, TooltipAnchor } from '../models/index.js'

/** Props for {@link StackedTooltip}. */
export interface StackedTooltipProps {
  /** The month's readout. */
  readonly readout: MonthReadout
  /** Where it sits: beside the bar, never over it. */
  readonly anchor: TooltipAnchor
  /** Formats a decimal-string amount for display. */
  readonly formatMoney: (value: string) => string
}

/**
 * The readout shown beside the hovered or focused month: each category's
 * spending, top of the bar first, and the total.
 *
 * Beside the bar, not over it. With six categories the readout is taller than
 * most bars, so centring it above the bar would hide the bar being read and its
 * neighbours.
 *
 * Amounts are plain, not signed: the chart is about spending, so a positive
 * figure is money that went out. A negative one is a category whose refunds
 * outweighed its spending, and is marked as such.
 */
export function StackedTooltip({ readout, anchor, formatMoney }: StackedTooltipProps) {
  return (
    <div className={`spt__tip spt__tip--${anchor.side}`} style={{ left: `${anchor.leftPercent}%`, top: 0 }}>
      <span className="spt__tip-label">{monthLabelLong(readout.month)}</span>
      {readout.rows.length === 0 ? (
        <span className="spt__tip-empty">No spending</span>
      ) : (
        readout.rows.map((r) => (
          <span className="spt__tip-row" key={r.id}>
            <span className="spt__swatch is-solid" style={{ background: r.color, borderColor: r.color }} />
            <span className="spt__tip-name">{r.name}</span>
            <strong className={isNegativeAmount(r.value) ? 'is-neg' : undefined}>
              {formatMoney(r.value)}
            </strong>
          </span>
        ))
      )}
      {readout.rows.length > 1 ? (
        <span className="spt__tip-total">
          <span className="spt__tip-name">Total</span>
          <strong>{formatMoney(readout.total)}</strong>
        </span>
      ) : null}
    </div>
  )
}
