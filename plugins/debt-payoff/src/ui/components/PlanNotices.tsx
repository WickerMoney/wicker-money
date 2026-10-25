import type { PlanResponse } from '../../shared/index.js'
import { durationText } from '../helpers/durationText.js'
import { excludingText } from '../helpers/excludingText.js'

/** Props for {@link PlanNotices}. */
export interface PlanNoticesProps {
  readonly plan: PlanResponse
  readonly formatMoney: (value: string) => string
}

/**
 * Things about this plan the person should not have to discover: it never ends,
 * a minimum is not keeping up with its interest, or debts they switched off are
 * not in it.
 *
 * Each is a sentence, so none depends on colour.
 */
export function PlanNotices({ plan, formatMoney }: PlanNoticesProps) {
  const stuck = plan.debts.filter((d) => Number(d.startingBalance) > 0 && !d.minimumCoversInterest)
  const limit = durationText(plan.monthLimit)
  const left = plan.excludedDebts.map((d) => d.name)
  const oversized = plan.debts.filter((d) => d.earmarkCoversBalance)
  if (!plan.capped && stuck.length === 0 && left.length === 0 && oversized.length === 0) return null
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
      {left.length > 0 ? (
        <p>
          Not in this plan: {excludingText(left)}. They stay in your list, but the dates and totals here do not
          include them. Tick "In plan" on a debt to bring it back.
        </p>
      ) : null}
      {oversized.map((d) => (
        <p key={d.id}>
          The {formatMoney(d.extraPayment)} a month set on {d.name} is more than it needs: it owes{' '}
          {formatMoney(d.startingBalance)}, so it is paid off in the first month and the rest of that amount is not used.
        </p>
      ))}
      {stuck.map((d) => (
        <p key={d.id}>
          The {formatMoney(d.minimumPayment)} minimum on {d.name} does not cover its first month of interest, so it
          only shrinks when extra money is aimed at it.
        </p>
      ))}
    </div>
  )
}
