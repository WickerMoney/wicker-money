import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PluginPageProps } from '@wickermoney/plugin-sdk/runtime'
import { Alert, Button, EmptyState, Spinner, Surface } from '@wickermoney/ui-kit'
import './styles.js'
import { Assumptions } from './components/Assumptions.js'
import { DebtDialog } from './components/DebtDialog.js'
import { DebtsTable } from './components/DebtsTable.js'
import { ExtraPaymentForm } from './components/ExtraPaymentForm.js'
import { PayoffChart } from './components/PayoffChart.js'
import { PayoffOrderTable } from './components/PayoffOrderTable.js'
import { PlanNotices } from './components/PlanNotices.js'
import { PlanTotals } from './components/PlanTotals.js'
import { StrategyToggle } from './components/StrategyToggle.js'
import { EMPTY_DRAFT } from './helpers/EMPTY_DRAFT.js'
import { draftFromDebt } from './helpers/draftFromDebt.js'
import { durationText } from './helpers/durationText.js'
import { excludingText } from './helpers/excludingText.js'
import { useDebtPayoff } from './hooks/useDebtPayoff.js'
import type { AccountSuggestion, Debt, DebtDraft } from './models/index.js'

/** The dialog being shown: a blank or prefilled form, or a saved debt. */
interface DialogState {
  readonly editing: Debt | null
  readonly initial: DebtDraft
}

/**
 * "When will I be debt free?"
 *
 * The person lists their debts (balance, rate, minimum), picks snowball or
 * avalanche and an extra amount to pay each month, and the page shows the
 * result: the date the last debt is cleared, the interest, what it saves against
 * paying only the minimums, a chart of what is owed month by month, and the
 * order the debts fall in. The arithmetic is the server's
 * (`GET /plan`); this page only asks and shows.
 *
 * The rules behind the numbers are written on the page, because a payoff date
 * is only as good as its assumptions.
 *
 * Exposed to the host as a default export.
 */
export default function DebtPayoffPage({ ctx }: PluginPageProps) {
  const payoff = useDebtPayoff(ctx)
  const { debts, plan, settings, suggestions, colors } = payoff
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const addRef = useRef<HTMLSpanElement>(null)
  // Bumped when the debt a dialog was opened from is gone, so focus has somewhere to land.
  const [refocus, setRefocus] = useState(0)

  useEffect(() => { if (refocus > 0) addRef.current?.querySelector('button')?.focus() }, [refocus])

  const { formatMoney: hostMoney, formatDate: hostDate } = ctx
  const formatMoney = useCallback((value: string) => hostMoney(value), [hostMoney])
  const formatDate = useCallback((value: string) => hostDate(value), [hostDate])

  const accountNames = useMemo(() => new Map(suggestions.map((a) => [a.id, a.name] as const)), [suggestions])
  const payoffDates = useMemo(
    () => new Map((plan?.debts ?? []).map((d) => [d.id, d.payoffDate] as const)),
    [plan],
  )
  const { setIncluded } = payoff
  // Stable, so the memoised debt list is not redrawn when something else on the page changes.
  const toggleIncluded = useCallback((debt: Debt, included: boolean) => { void setIncluded(debt, included) }, [setIncluded])
  const edit = useCallback((debt: Debt) => setDialog({ editing: debt, initial: draftFromDebt(debt) }), [])
  const add = (from?: AccountSuggestion) => setDialog({
    editing: null,
    initial: from === undefined ? EMPTY_DRAFT : { ...EMPTY_DRAFT, name: from.name, accountId: from.id },
  })

  const active = (debts ?? []).filter((d) => !d.archived)
  const nothingInPlan = plan !== null && plan.debts.length === 0
  const nothingOwed = plan !== null && plan.debts.length > 0 && plan.schedule.length === 0
  const leftOut = plan === null ? '' : excludingText(plan.excludedDebts.map((d) => d.name))
  const excluding = leftOut === '' ? '' : ` (excluding ${leftOut})`
  const untracked = suggestions.filter((a) => a.debtId === null)

  return (
    <div className="page dp">
      <h1 className="page__title">Debt payoff</h1>
      {payoff.message !== null ? <Alert>{payoff.message}</Alert> : null}
      {/* Always mounted, so a screen reader is already watching it when a save lands. */}
      <div className="wm-visually-hidden" role="status" aria-live="polite" aria-atomic="true">{payoff.status}</div>

      <Surface
        title="Your debts"
        action={
          <div className="dp-actions">
            <label className="check">
              <input
                type="checkbox"
                checked={payoff.showArchived}
                onChange={(e) => payoff.setShowArchived(e.target.checked)}
              />
              <span>Show archived</span>
            </label>
            <span ref={addRef}>
              <Button variant="primary" onClick={() => add()}>Add a debt</Button>
            </span>
          </div>
        }
      >
        {debts === null ? <Spinner label="Loading your debts" /> : debts.length === 0 ? (
          <EmptyState
            title="No debts yet"
            hint="Add the loans and cards you want to pay off and see the date you will be free of them."
            action={
              untracked.length > 0 ? (
                <div className="dp-start">
                  <p className="dp-muted">Start from one of your accounts:</p>
                  <div className="dp-start__list">
                    {untracked.map((a) => (
                      <Button key={a.id} onClick={() => add(a)}>Add {a.name}</Button>
                    ))}
                  </div>
                </div>
              ) : undefined
            }
          />
        ) : (
          <DebtsTable
            debts={debts}
            colors={colors}
            payoffDates={payoffDates}
            accountNames={accountNames}
            formatMoney={formatMoney}
            formatDate={formatDate}
            busy={payoff.busy}
            onEdit={edit}
            onToggleIncluded={toggleIncluded}
          />
        )}
      </Surface>

      {settings !== null && active.length > 0 ? (
        <Surface
          title="Payoff plan"
          action={payoff.planLoading && plan !== null ? <span className="dp-muted" role="status">Updating…</span> : undefined}
        >
          <div className="dp-controls">
            <StrategyToggle value={settings.strategy} disabled={payoff.busy} onChange={(s) => void payoff.chooseStrategy(s)} />
            <ExtraPaymentForm saved={settings.extraPayment} busy={payoff.busy} onApply={payoff.applyExtra} />
          </div>

          {plan === null ? <Spinner label="Working out the plan" /> : nothingInPlan ? (
            <p className="dp-muted" role="status">
              Nothing is in the plan. Tick "In plan" on a debt above to see when you will be free of it.
            </p>
          ) : nothingOwed ? (
            <p className="dp-muted" role="status">Every debt on the list is already at zero, so there is nothing to pay off.</p>
          ) : (
            <>
              <p className="dp-headline" role="status">
                {plan.debtFreeDate === null
                  ? `Not debt free${excluding} within ${durationText(plan.monthLimit)} at these payments.`
                  : `Debt free${excluding} on ${formatDate(plan.debtFreeDate)}, ${durationText(plan.months)} from now.`}
              </p>
              {Number(plan.earmarked) > 0 ? (
                <p className="dp-muted">
                  Each month: {formatMoney(plan.monthlyBudget)} pooled + {formatMoney(plan.earmarked)} earmarked for
                  single debts, until each is paid off.
                </p>
              ) : null}
              <PlanNotices plan={plan} formatMoney={formatMoney} formatDate={formatDate} />
              <PlanTotals plan={plan} formatMoney={formatMoney} formatDate={formatDate} />
              <h3 className="dp-h3">What you owe, month by month</h3>
              <PayoffChart plan={plan} colors={colors} formatMoney={formatMoney} formatDate={formatDate} />
              <h3 className="dp-h3">Order of payoff</h3>
              <PayoffOrderTable plan={plan} colors={colors} formatMoney={formatMoney} formatDate={formatDate} />
            </>
          )}
        </Surface>
      ) : null}

      <Surface title="How this is worked out">
        <Assumptions plan={plan} formatDate={formatDate} />
      </Surface>

      {dialog !== null ? (
        <DebtDialog
          editing={dialog.editing}
          initial={dialog.initial}
          suggestions={suggestions}
          busy={payoff.busy}
          onSave={(draft) => payoff.saveDebt(dialog.editing?.id ?? null, draft)}
          onRemove={async (debt) => {
            const removed = await payoff.removeDebt(debt)
            if (removed) setRefocus((n) => n + 1)
            return removed
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  )
}
