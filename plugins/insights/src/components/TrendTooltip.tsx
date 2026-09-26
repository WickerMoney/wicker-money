import { absAmount } from '../helpers/absAmount.js'
import { isNegativeAmount } from '../helpers/isNegativeAmount.js'
import { monthLabelLong } from '../helpers/monthLabel.js'
import type { MonthTotal } from '../models/index.js'

/** Props for {@link TrendTooltip}. */
export interface TrendTooltipProps {
  /** The month whose totals are shown. */
  readonly month: MonthTotal
  /** Horizontal position as a percentage of the chart width. */
  readonly leftPercent: number
  /** Formats a decimal-string amount for display. */
  readonly formatMoney: (value: string) => string
}

/** The readout shown above the hovered or focused month in the income/spending chart. */
export function TrendTooltip({ month, leftPercent, formatMoney }: TrendTooltipProps) {
  const down = isNegativeAmount(month.net)
  return (
    <div className="viz__tip" style={{ left: `${leftPercent}%`, top: 0 }}>
      <span className="viz__tip-label">{monthLabelLong(month.month)}</span>
      <span className="viz__tip-row">
        <span className="viz__swatch" style={{ background: 'var(--viz-3)' }} />
        <strong>{formatMoney(month.income)}</strong> in
      </span>
      <span className="viz__tip-row">
        <span className="viz__swatch" style={{ background: 'var(--viz-4)' }} />
        <strong>{formatMoney(month.expense)}</strong> out
      </span>
      <span className={`viz__tip-net${down ? ' is-neg' : ''}`}>
        {down ? 'Down ' : 'Up '}
        <strong>{formatMoney(absAmount(month.net))}</strong>
      </span>
    </div>
  )
}
