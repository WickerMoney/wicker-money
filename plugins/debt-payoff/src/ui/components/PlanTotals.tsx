import { Stat } from '@wickermoney/ui-kit'
import type { PayoffPlan } from '../../shared/index.js'
import { durationText } from '../helpers/durationText.js'

/** Props for {@link PlanTotals}. */
export interface PlanTotalsProps {
  readonly plan: PayoffPlan
  readonly formatMoney: (value: string) => string
  readonly formatDate: (value: string) => string
}

/**
 * The headline numbers: when the last debt is paid, what it costs, and what the
 * plan saves against paying only the minimums.
 *
 * "Saved" figures are the API's own comparison. When either scenario never
 * pays off within the limit there is nothing honest to subtract, so the tile
 * says so rather than showing a made-up figure.
 */
export function PlanTotals({ plan, formatMoney, formatDate }: PlanTotalsProps) {
  const limit = durationText(plan.monthLimit)
  const comparable = plan.monthsSaved !== null && plan.interestSaved !== null
  const baseline = plan.minimumsOnly
  const baselineText = baseline.capped
    ? `Paying only the minimums, you would not be debt free within ${limit}.`
    : `Paying only the minimums: debt free ${baseline.debtFreeDate === null ? '' : formatDate(baseline.debtFreeDate)}, ${durationText(baseline.months)}, ${formatMoney(baseline.totalInterest)} of interest.`
  return (
    <div className="dp-totals-block">
      <div className="dp-totals">
        <div><Stat label="Debt-free date" value={plan.debtFreeDate === null ? `Not within ${limit}` : formatDate(plan.debtFreeDate)} /></div>
        <div><Stat label="Time to go" value={plan.capped ? `More than ${limit}` : durationText(plan.months)} /></div>
        <div><Stat label="Interest you pay" value={formatMoney(plan.totalInterest)} /></div>
        <div><Stat label="Paid each month" value={formatMoney(plan.monthlyBudget)} /></div>
        <div>
          <Stat
            label="Time saved vs minimums only"
            value={comparable && plan.monthsSaved !== null ? durationText(plan.monthsSaved) : 'Not comparable'}
            tone={comparable && (plan.monthsSaved ?? 0) > 0 ? 'positive' : 'neutral'}
          />
        </div>
        <div>
          <Stat
            label="Interest saved vs minimums only"
            value={comparable && plan.interestSaved !== null ? formatMoney(plan.interestSaved) : 'Not comparable'}
            tone={comparable && plan.interestSaved !== null && Number(plan.interestSaved) > 0 ? 'positive' : 'neutral'}
          />
        </div>
      </div>
      <p className="dp-muted">{baselineText}</p>
    </div>
  )
}
