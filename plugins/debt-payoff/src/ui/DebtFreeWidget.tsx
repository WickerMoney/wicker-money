import { useEffect, useState } from 'react'
import type { PluginWidgetProps } from '@wickermoney/plugin-sdk/runtime'
import { Button, EmptyState, Spinner } from '@wickermoney/ui-kit'
import './styles.js'
import { DEBT_PAYOFF_API_BASE } from '../server/constants.js'
import type { PlanResponse } from '../shared/index.js'
import { DEBT_PAYOFF_PAGE_PATH } from './helpers/DEBT_PAYOFF_PAGE_PATH.js'
import { STRATEGY_INFO } from './helpers/STRATEGY_INFO.js'
import { durationText } from './helpers/durationText.js'
import { excludingText } from './helpers/excludingText.js'

/**
 * A dashboard card: the date the last debt is cleared, and which debt is next.
 *
 * It reads the plan for the person's saved strategy and extra, so it agrees
 * with the Debt payoff page. At `sm` it is the date and the next debt; from
 * `md` up it adds what the plan saves against minimums only. It never shows a
 * date it does not have: a plan that does not finish says so. Debts the person
 * switched out of the plan are named under the date, so the date is not read as
 * covering them.
 *
 * Exposed to the host as a default export.
 */
export default function DebtFreeWidget({ ctx, size }: PluginWidgetProps) {
  const [plan, setPlan] = useState<PlanResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { api } = ctx
  const { timezone } = ctx.session

  useEffect(() => {
    // Aborting on cleanup discards a slow answer for an earlier request.
    const controller = new AbortController()
    const { signal } = controller
    api
      .get<PlanResponse>(`${DEBT_PAYOFF_API_BASE}/plan?tz=${encodeURIComponent(timezone)}`, { signal })
      .then((p) => { if (!signal.aborted) { setPlan(p); setError(null) } })
      .catch((e: unknown) => {
        if (!signal.aborted) setError(e instanceof Error ? e.message : 'Could not load the payoff plan.')
      })
    return () => controller.abort()
  }, [api, timezone])

  const open = () => ctx.navigate(DEBT_PAYOFF_PAGE_PATH)

  if (error !== null) return <EmptyState title="Debt payoff unavailable" hint={error} />
  if (plan === null) return <Spinner label="Loading the payoff plan" />

  if (plan.debts.length === 0 && plan.excludedDebts.length > 0) {
    return (
      <EmptyState
        title="Nothing is in the plan"
        hint="Every debt you track is switched out of it. Tick &quot;In plan&quot; on one to see a date."
        action={<Button variant="primary" onClick={open}>Open debt payoff</Button>}
      />
    )
  }

  if (plan.schedule.length === 0) {
    return (
      <EmptyState
        title={plan.debts.length === 0 ? 'No debts tracked' : 'Nothing left to pay off'}
        hint={plan.debts.length === 0
          ? 'Add your loans and cards to see the date you will be debt free.'
          : 'Every debt on the list is at zero.'}
        action={<Button variant="primary" onClick={open}>{plan.debts.length === 0 ? 'Add a debt' : 'Open debt payoff'}</Button>}
      />
    )
  }

  const next = plan.debts.find((d) => d.id === plan.order[0])
  const limit = durationText(plan.monthLimit)
  const showSavings = size !== 'sm' && plan.monthsSaved !== null && plan.interestSaved !== null

  return (
    <div className={`dpw dpw--${size}`}>
      <p className="dpw__label">Debt-free date</p>
      <p className="dpw__date">{plan.debtFreeDate === null ? `Not within ${limit}` : ctx.formatDate(plan.debtFreeDate)}</p>
      {plan.excludedDebts.length > 0 ? (
        <p className="dpw__sub">Not counting {excludingText(plan.excludedDebts.map((d) => d.name))}.</p>
      ) : null}
      <p className="dpw__sub">
        {plan.debtFreeDate === null
          ? 'Raise the extra payment to bring an end date into view.'
          : `${durationText(plan.months)} to go, ${STRATEGY_INFO[plan.strategy].label.toLowerCase()} plan`}
      </p>

      {next !== undefined ? (
        <div className="dpw__next">
          <p className="dpw__label">Next in line</p>
          <p className="dpw__next-name">{next.name}</p>
          <p className="dpw__sub">
            {ctx.formatMoney(next.startingBalance)}
            {next.payoffDate === null ? '' : `, paid off ${ctx.formatDate(next.payoffDate)}`}
          </p>
        </div>
      ) : null}

      {showSavings ? (
        <p className="dpw__sub">
          Saves {ctx.formatMoney(plan.interestSaved ?? '0')} of interest and {durationText(plan.monthsSaved ?? 0)} against
          paying only the minimums.
        </p>
      ) : null}

      <div className="dpw__foot">
        <Button onClick={open}>Open debt payoff</Button>
      </div>
    </div>
  )
}
