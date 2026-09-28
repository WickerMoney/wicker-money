import { isNegativeAmount } from '../helpers/isNegativeAmount.js'
import { subtractAmounts } from '../helpers/subtractAmounts.js'

/** Props for {@link TrendLegend}. */
export interface TrendLegendProps {
  /** Sum of income and of expense across every month shown, as decimal strings. */
  readonly totals: { readonly income: string; readonly expense: string }
  /** Formats a decimal string as money. */
  readonly formatMoney: (value: string) => string
}

/**
 * The legend for the income/spending chart, with the range totals beside each key.
 *
 * Two series, so a legend is not optional. Putting the values beside each key
 * also provides the contrast relief the light-mode palette requires.
 */
export function TrendLegend({ totals, formatMoney }: TrendLegendProps) {
  const net = subtractAmounts(totals.income, totals.expense)
  return (
    <div className="viz__legend viz__legend--inline">
      <div className="viz__legend-row">
        <span className="viz__swatch" style={{ background: 'var(--viz-1)' }} />
        <span>Income</span>
        <span className="viz__legend-value">{formatMoney(totals.income)}</span>
      </div>
      <div className="viz__legend-row">
        <span className="viz__swatch" style={{ background: 'var(--viz-2)' }} />
        <span>Spending</span>
        <span className="viz__legend-value">{formatMoney(totals.expense)}</span>
      </div>
      <div className="viz__legend-row">
        <span className="viz__net-key" aria-hidden="true" />
        <span>Net</span>
        <span className={`viz__legend-value${isNegativeAmount(net) ? ' is-neg' : ''}`}>
          {formatMoney(net)}
        </span>
      </div>
    </div>
  )
}
