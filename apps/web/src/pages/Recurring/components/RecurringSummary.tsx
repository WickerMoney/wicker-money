import { Stat, Surface } from '@wickermoney/ui-kit'
import { formatMoney } from '../../../lib/formatMoney.js'
import type { RecurringItemList } from '../../../models/index.js'

/** Props for {@link RecurringSummary}. */
export interface RecurringSummaryProps {
  readonly summary: RecurringItemList['summary']
  readonly currency: string
}

/**
 * Monthly rates across the active items, computed by the server with exact
 * factors (a biweekly paycheck is 26/12 a month, not ×2.17). Transfers are
 * left out: moving money between your own accounts is not spending.
 */
export function RecurringSummary({ summary, currency }: RecurringSummaryProps) {
  return (
    <Surface title="Per month">
      <div className="recur-tiles">
        <Stat label="Income" value={formatMoney(summary.monthlyIncome, currency)} tone="positive" />
        <Stat label="Bills and debt payments" value={formatMoney(summary.monthlyOutgoings, currency)} tone="negative" />
        <Stat label="Left over" value={formatMoney(summary.monthlyNet, currency)} tone="auto" />
      </div>
      <p className="form-hint recur-tiles__hint">Transfers between your own accounts are not counted.</p>
    </Surface>
  )
}
