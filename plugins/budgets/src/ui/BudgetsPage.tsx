import { useState } from 'react'
import type { PluginPageProps } from '@wickermoney/plugin-sdk'
import { Alert, Spinner, Surface } from '@wickermoney/ui-kit'
import './styles.js'
import { AccountLineForm } from './components/AccountLineForm.js'
import { AccountLinesTable } from './components/AccountLinesTable.js'
import { AddLineForm } from './components/AddLineForm.js'
import { AdoptDraftBanner } from './components/AdoptDraftBanner.js'
import { BudgetLinesTable } from './components/BudgetLinesTable.js'
import { MonthNavigator } from './components/MonthNavigator.js'
import { MonthTotals } from './components/MonthTotals.js'
import { UnbudgetedPanel } from './components/UnbudgetedPanel.js'
import { WindowForm } from './components/WindowForm.js'
import { monthLabel } from './helpers/monthLabel.js'
import { useBudgetMonth } from './hooks/useBudgetMonth.js'
import type { AccountLine, MonthLine } from './models/index.js'

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
  const [editingWindow, setEditingWindow] = useState<MonthLine | null>(null)
  const [editingAccountLine, setEditingAccountLine] = useState<AccountLine | null>(null)
  const accountLines = month?.accountLines ?? []
  const categoryNames = new Map(budget.categories.map((c) => [c.id, c.name]))

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
            {(month.draft && month.lines.some((l) => l.draft)) || accountLines.some((l) => l.draft) ? (
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
            planErrors={budget.planErrors}
            busy={budget.busy}
            formatMoney={money}
            formatDate={ctx.formatDate}
            onEditPlan={budget.editPlan}
            onSave={(line, planned, rollover) => void budget.save(line, planned, rollover)}
            onRemove={(line) => {
              if (editingWindow?.id === line.id) setEditingWindow(null)
              void budget.remove(line)
            }}
            onEditWindow={setEditingWindow}
          />

          <p className="bud__note">
            <strong>Rolls over</strong> makes a line a sinking fund: what is left at the end of the
            month is added to the next one, and overspending is carried too. Leave it off for a
            monthly allowance like groceries. The mark on each bar is today — a line at 80% is
            fine near the end of the month and a problem near the start. A <strong>window</strong>{' '}
            is measured against its own dates instead of the month.
          </p>

          <AddLineForm
            categories={budget.categories}
            lines={month.lines}
            busy={budget.busy}
            onAdd={budget.addLine}
          />
        </Surface>
      ) : null}

      {month !== null ? (
        <Surface title="Windows">
          <WindowForm
            categories={budget.categories}
            monthKey={monthKey}
            editing={editingWindow}
            busy={budget.busy}
            onSave={budget.saveWindow}
            onCancel={() => setEditingWindow(null)}
          />
        </Surface>
      ) : null}

      {month !== null ? (
        <Surface title="Account allowances">
          <p className="bud__note">
            An allowance is money set aside to spend from one account, like $150 a month of
            spending money. It counts everything that leaves the account, whatever the category,
            except the categories you leave out, so holiday gifts that have a window of their own
            do not eat into it. What is left carries into next month. It is kept out of the totals
            above, since the same spending is also counted in its categories.
          </p>
          {accountLines.length > 0 ? (
            <AccountLinesTable
              lines={accountLines}
              monthKey={monthKey}
              today={month.today}
              busy={budget.busy}
              categoryName={(id) => categoryNames.get(id) ?? 'a removed category'}
              formatMoney={money}
              onEdit={setEditingAccountLine}
              onRemove={(line) => {
                if (editingAccountLine?.accountId === line.accountId) setEditingAccountLine(null)
                void budget.removeAccountLine(line)
              }}
            />
          ) : null}
          <AccountLineForm
            accounts={budget.accounts}
            categories={budget.categories}
            editing={editingAccountLine}
            busy={budget.busy}
            onSave={budget.saveAccountLine}
            onCancel={() => setEditingAccountLine(null)}
          />
        </Surface>
      ) : null}

      {month !== null && month.unbudgeted.length > 0 ? (
        <UnbudgetedPanel month={month} formatMoney={money} />
      ) : null}
    </div>
  )
}
