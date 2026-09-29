import { useMemo, useState } from 'react'
import { Alert, EmptyState, Spinner, Surface } from '@wickermoney/ui-kit'
import { useActionStatus, type ActionStatus } from '../../hooks/useActionStatus.js'
import type { Account, Category, RecurringItemList } from '../../models/index.js'
import { RecurringItemForm } from './components/RecurringItemForm.js'
import { RecurringSection } from './components/RecurringSection.js'
import { RecurringSummary } from './components/RecurringSummary.js'
import { groupItems } from './helpers/groupItems.js'
import { useRecurringData } from './hooks/useRecurringData.js'
import { useRecurringEditing } from './hooks/useRecurringEditing.js'

/**
 * Recurring items: the one place to see and manage what is expected to come in
 * and go out, and when.
 *
 * Everything that depends on "today" (next due dates, which series have ended,
 * the monthly tiles) comes from the server, computed in the user's time zone;
 * the page only formats it. The form's next-dates preview is the exception,
 * because an unsaved item has nothing to ask the server about.
 */
export function RecurringPage() {
  const status = useActionStatus()
  const [notice, setNotice] = useState<string | null>(null)
  const data = useRecurringData(status)

  return (
    <div className="page">
      <div className="page__head">
        <h1 className="page__title">Recurring</h1>
        <label className="check">
          <input type="checkbox" checked={data.includeEnded}
                 onChange={(e) => data.setIncludeEnded(e.target.checked)} />
          <span>Show ended</span>
        </label>
      </div>
      {status.message !== null ? <Alert>{status.message}</Alert> : null}
      {notice !== null ? <Alert>{notice}</Alert> : null}

      {data.list === null ? <Spinner /> : (
        <Workspace
          list={data.list} accounts={data.accounts} categories={data.categories}
          status={status} reload={data.reload} showNotice={setNotice}
        />
      )}
    </div>
  )
}

/** Props for {@link Workspace}. */
interface WorkspaceProps {
  readonly list: RecurringItemList
  readonly accounts: readonly Account[]
  readonly categories: readonly Category[]
  readonly status: ActionStatus
  readonly reload: () => Promise<void>
  readonly showNotice: (message: string | null) => void
}

/** The loaded page: summary, grouped lists and the form. Mounted once the server's today is known. */
function Workspace({ list, accounts, categories, status, reload, showNotice }: WorkspaceProps) {
  const active = useMemo(() => accounts.filter((a) => a.archivedAt === null), [accounts])
  // New bills default to paying from a checking account, not whichever account sorts first.
  const payer = active.find((a) => a.accountType === 'checking') ?? active[0]
  const editing = useRecurringEditing(status, reload, list.today, payer?.id ?? '', showNotice)
  const groups = groupItems(list.items)
  // Single currency for now: every account shares the first one's.
  const currency = accounts[0]?.currencyCode ?? 'USD'

  const accountNames = useMemo(() => new Map(accounts.map((a) => [a.id, a.name])), [accounts])
  const categoryNames = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories])
  const accountName = (id: string) => accountNames.get(id) ?? 'Unknown account'
  const categoryName = (id: string | null) => (id === null ? null : categoryNames.get(id) ?? null)

  const section = (title: string, items: typeof list.items) => (
    <RecurringSection
      title={title} items={items} currency={currency}
      accountName={accountName} categoryName={categoryName} busy={status.busy}
      onEdit={editing.edit} onEnd={(i) => void editing.end(i)} onDelete={(i) => void editing.remove(i)}
    />
  )

  return (
    <>
      <RecurringSummary summary={list.summary} currency={currency} />
      <div className="page__split recur-split">
        <div className="page">
          {list.items.length === 0 ? (
            <Surface>
              <EmptyState
                title="Nothing recurring yet"
                hint="Add your paychecks, bills and regular transfers to see what is due and when."
              />
            </Surface>
          ) : (
            <>
              {section('Income', groups.income)}
              {section('Bills and debt payments', groups.outgoing)}
              {section('Transfers', groups.transfers)}
            </>
          )}
        </div>
        {active.length === 0 ? (
          <Surface title="Add a recurring item">
            <EmptyState title="Add an account first" hint="A recurring item needs an account for its money to land in." />
          </Surface>
        ) : (
          <RecurringItemForm
            draft={editing.draft} editing={editing.editing}
            accounts={active} categories={categories} today={list.today} busy={status.busy}
            onChange={editing.change} onSubmit={() => void editing.save()} onCancel={editing.reset}
          />
        )}
      </div>
    </>
  )
}
