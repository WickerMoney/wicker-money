import type { PluginPageProps } from '@wickermoney/plugin-sdk'
import { Alert, Spinner, Surface } from '@wickermoney/ui-kit'
import './styles.js'
import { AddLineForm } from './components/AddLineForm.js'
import { AdoptDraftBanner } from './components/AdoptDraftBanner.js'
import { BudgetLinesTable } from './components/BudgetLinesTable.js'
import { MonthNavigator } from './components/MonthNavigator.js'
import { MonthTotals } from './components/MonthTotals.js'
import { UnbudgetedPanel } from './components/UnbudgetedPanel.js'
import { monthLabel } from './helpers/monthLabel.js'
import { useBudgetMonth } from './hooks/useBudgetMonth.js'

/**
 * A month of budget, as one editable table.
 *
 * Two behaviours shape the page.
 *
 * **A month that has not been planned yet is shown as a draft, not as
 * emptiness.** Last month's lines appear with their plans, greyed, and nothing
 * is written until the user changes one or accepts the lot. Opening next month
 * to see what it looks like is a read, and a read must not write.
 *
 * **Every number except the plan is derived.** Spend, carry-forward and
 * remaining are recomputed from the ledger on each load, so nothing here can
 * disagree with the transactions page, and a receipt imported late against an
 * old month silently corrects every month after it.
 *
 * Exposed to the host as a default export.
 */
export default function BudgetsPage({ ctx }: PluginPageProps) {
  const budget = useBudgetMonth(ctx)
  const { month, monthKey } = budget
  const money = ctx.formatMoney

  return (
    <div className="page bud">
      <h1 className="page__title">Budgets</h1>
      {budget.message !== null ? <Alert>{budget.message}</Alert> : null}

      <Surface title={monthLabel(monthKey)}>
        <MonthNavigator
          monthKey={monthKey}
          draft={month?.draft === true}
          onPrevious={budget.previousMonth}
          onNext={budget.nextMonth}
          onThisMonth={budget.thisMonth}
        />

        {month === null ? <Spinner label="Loading the month" /> : (
          <>
            <MonthTotals summary={month.summary} formatMoney={money} />
            {month.draft && month.lines.length > 0 ? (
              <AdoptDraftBanner
                monthKey={monthKey}
                busy={budget.busy}
                onAdopt={() => void budget.adopt()}
              />
            ) : null}
          </>
        )}
      </Surface>

      {month !== null ? (
        <Surface title="Lines">
          <BudgetLinesTable
            month={month}
            edits={budget.edits}
            busy={budget.busy}
            formatMoney={money}
            onEditPlan={budget.editPlan}
            onSave={(line, planned, rollover) => void budget.save(line, planned, rollover)}
            onRemove={(line) => void budget.remove(line)}
          />

          <p className="bud__note">
            <strong>Rolls over</strong> makes a line a sinking fund: what is left at the end of the
            month is added to the next one, and overspending is carried too. Leave it off for a
            monthly allowance like groceries. The mark on each bar is today — a line at 80% is
            fine near the end of the month and a problem near the start.
          </p>

          <AddLineForm
            categories={budget.categories}
            lines={month.lines}
            busy={budget.busy}
            onAdd={(categoryId) => void budget.addLine(categoryId)}
          />
        </Surface>
      ) : null}

      {month !== null && month.unbudgeted.length > 0 ? (
        <UnbudgetedPanel month={month} formatMoney={money} />
      ) : null}
    </div>
  )
}
