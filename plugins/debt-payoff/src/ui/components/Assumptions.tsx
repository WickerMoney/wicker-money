import type { PayoffPlan } from '../../shared/index.js'
import { durationText } from '../helpers/durationText.js'

/** Props for {@link Assumptions}. */
export interface AssumptionsProps {
  /** The plan, for the date balances are as of and the limit; `null` before one has loaded. */
  readonly plan: PayoffPlan | null
  readonly formatDate: (value: string) => string
}

/**
 * What the numbers assume, in plain words. Always on the page, because a payoff
 * date is only as good as the rules behind it.
 */
export function Assumptions({ plan, formatDate }: AssumptionsProps) {
  return (
    <ul className="dp-assume">
      <li>
        <strong>Interest:</strong> each month a debt adds its yearly rate divided by 12, times what it owed at the
        start of that month (the nominal rate, compounded monthly). Your card's own statement may differ a little.
      </li>
      <li>
        <strong>Payments:</strong> made at the end of each month, starting a month from{' '}
        {plan === null ? 'today' : formatDate(plan.startDate)}, when the balances are as you entered them.
      </li>
      <li>
        <strong>Rounding:</strong> interest is rounded once for each debt each month, to four decimal places, with
        halves rounded away from zero. Nothing else is rounded, so the totals add up exactly.
      </li>
      <li>
        <strong>The same payment every month:</strong> your minimums plus the extra for all debts. When a debt is paid
        off its minimum moves on to the next debt in line.
      </li>
      <li>
        <strong>Extra for one debt:</strong> an amount set on a debt is paid to it every month on top of its minimum,
        apart from the extra for all debts. When that debt is paid off the amount stops; it does not move to another
        debt, so the debt-free date can come later. Raise another debt's own amount, or the extra for all debts, to
        keep that money working.
      </li>
      <li>
        <strong>Deferred loans:</strong> a debt with a repayment start date owes no minimum until the first month
        whose payment date falls on or after it. Until then interest keeps adding to its balance and the extra money
        skips it (only an amount set on that debt can pay it early). Its minimum joins the monthly payment when it
        starts.
      </li>
      <li>
        <strong>Promotional rates:</strong> a debt uses its promotional rate through the last payment on or before
        the promotion's end date. With interest charged back if not paid off, the plan first pays that debt the even
        amount that would clear it in time, out of your monthly payment, then spreads the rest. If the payment cannot
        cover it, the interest at the standard rate for the whole promotion is added in the last month, on the
        original balance or the falling one as you chose.
      </li>
      <li>
        <strong>How interest is worked out:</strong> monthly unless a debt says otherwise. Daily compounding and
        simple daily interest use the real number of days between payment dates.
      </li>
      <li>
        <strong>Left out:</strong> a debt with "In plan" switched off stays in your list but is not counted anywhere:
        not in the dates, the totals, the order, or the money that moves on when another debt is paid off.
      </li>
      <li>
        <strong>Order:</strong> worked out once, from today's balances and rates. Snowball goes by smallest balance,
        avalanche by highest rate.
      </li>
      <li>
        <strong>Not modelled:</strong> new spending, fees and rate changes. The plan stops after{' '}
        {plan === null ? '50 years' : durationText(plan.monthLimit)}.
      </li>
    </ul>
  )
}
