import type { PayoffPlan } from '../../shared/index.js'
import { durationText } from '../helpers/durationText.js'

/** Props for {@link PlanNotices}. */
export interface PlanNoticesProps {
  readonly plan: PayoffPlan
  readonly formatMoney: (value: string) => string
}

/**
 * Things about this plan the person should not have to discover: it never ends,
 * or a minimum is not keeping up with its interest.
 *
 * Each is a sentence, so none depends on colour.
 */
export function PlanNotices({ plan, formatMoney }: PlanNoticesProps) {
  const stuck = plan.debts.filter((d) => Number(d.startingBalance) > 0 && !d.minimumCoversInterest)
  const limit = durationText(plan.monthLimit)
  if (!plan.capped && stuck.length === 0) return null
  return (
    <div className="dp-notice">
      {plan.capped ? (
        <p>
          {plan.cappedReason === 'balance_limit'
            ? 'At these payments the debts grow faster than they are paid, so the plan stops before it reaches zero.'
            : `At these payments the debts are not paid off within ${limit}, where the plan stops.`}{' '}
          Raise the extra payment or a minimum to see an end date.
        </p>
      ) : null}
      {stuck.map((d) => (
        <p key={d.id}>
          The {formatMoney(d.minimumPayment)} minimum on {d.name} does not cover its first month of interest, so it
          only shrinks when extra money is aimed at it.
        </p>
      ))}
    </div>
  )
}
