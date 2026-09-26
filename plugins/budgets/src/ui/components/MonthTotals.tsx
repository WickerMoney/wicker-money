import type { MonthSummary } from '../models/index.js'

/** Props for {@link MonthTotals}. */
export interface MonthTotalsProps {
  readonly summary: MonthSummary
  /** Formats a decimal string as money. */
  readonly formatMoney: (value: string) => string
}

/** The four headline figures for a month: planned, available, spent and remaining. */
export function MonthTotals({ summary, formatMoney: money }: MonthTotalsProps) {
  return (
    <div className="bud__totals">
      <div className="bud__total">
        <span className="bud__total-label">Planned</span>
        <span className="bud__total-value">{money(summary.planned)}</span>
      </div>
      <div className="bud__total">
        <span className="bud__total-label">Available</span>
        <span className="bud__total-value">{money(summary.available)}</span>
      </div>
      <div className="bud__total">
        <span className="bud__total-label">Spent</span>
        <span className="bud__total-value">{money(summary.spent)}</span>
      </div>
      <div className="bud__total">
        <span className="bud__total-label">Remaining</span>
        <span className="bud__total-value">{money(summary.remaining)}</span>
      </div>
    </div>
  )
}
