import { useCallback } from 'react'
import { EmptyState, Spinner, Table } from '@wickermoney/ui-kit'
import type { ActionStatus } from '../../../hooks/useActionStatus.js'
import type { Category, Transaction } from '../../../models/index.js'
import { useTransactionEditing } from '../hooks/useTransactionEditing.js'
import type { TransactionMatches } from '../hooks/useTransactionMatches.js'
import { TransactionActionsCell } from './TransactionActionsCell.js'
import { TransactionAmountCell } from './TransactionAmountCell.js'
import { TransactionCategoryCell } from './TransactionCategoryCell.js'
import { TransactionEditDialog } from './TransactionEditDialog.js'
import { TransactionRecurringCell } from './TransactionRecurringCell.js'
import { TransactionRecurringPicker } from './TransactionRecurringPicker.js'

/** Props for {@link TransactionTable}. */
export interface TransactionTableProps {
  /** `null` while the first page is loading. */
  readonly items: readonly Transaction[] | null
  /** Ids of the selected rows. */
  readonly selected: ReadonlySet<string>
  /** Whether the list is currently filtered to uncategorized transactions. */
  readonly onlyUncategorized: boolean
  /** Returns the categories to offer in one row's category cell. */
  readonly categoryOptionsFor: (currentId: string | null) => readonly Category[]
  /** Busy flag and error message shared with the page. */
  readonly status: ActionStatus
  /** Recurring-item matching for the listed rows; the column is left out without it. */
  readonly matches?: TransactionMatches
  /** Called to select or deselect one row. */
  readonly onToggleSelected: (id: string) => void
  /** Called to select or deselect every listed row. */
  readonly onToggleAllSelected: () => void
  /** Called after any change so the list can be re-read. */
  readonly onChanged: () => Promise<void>
}

/**
 * The transaction table, with a selection column, inline category assignment,
 * delete and, given `matches`, the recurring item each row settles or might.
 * A row's Edit button opens {@link TransactionEditDialog}.
 */
export function TransactionTable({
  items, selected, onlyUncategorized, categoryOptionsFor, status, matches,
  onToggleSelected, onToggleAllSelected, onChanged,
}: TransactionTableProps) {
  const row = useTransactionEditing(status, onChanged)
  const busy = status.busy
  const openPicker = matches?.openPicker
  const closePicker = matches?.closePicker
  /** The Link button: opens the row's picker, or closes it when it is open. */
  const toggleLink = useCallback((t: Transaction, open: boolean) => {
    if (open) void openPicker?.(t)
    else closePicker?.()
  }, [openPicker, closePicker])

  if (items === null) return <Spinner />

  const allSelected = items.length > 0 && items.every((t) => selected.has(t.id))

  return (
    <>
      <TransactionEditDialog row={row} busy={busy} />
      {/* One wrapper around the select-all and the table: app.css measures the
          room this wrapper has (a container query), not the window, because the
          sidebar takes a different share of it at different widths. Below about
          880px of room, and on phones, rows stop being table rows and the header
          row, with the select-all in it, is hidden, so the same control is offered
          here. Wider, the label stays hidden and the header checkbox does it. */}
      <div className="txn-list">
        {items.length > 0 ? (
          <label className="txn-select-all">
            <input type="checkbox" checked={allSelected} aria-label="Select all on this page"
                   onChange={onToggleAllSelected} />
            <span>Select all on this page</span>
          </label>
        ) : null}
        <Table
          caption="Transactions"
          className="txn-table"
          columns={[
            { key: 'sel',
              header: (
                <input type="checkbox" checked={allSelected} aria-label="Select all shown"
                       onChange={onToggleAllSelected} />
              ),
              render: (t: Transaction) => (
                <input type="checkbox" checked={selected.has(t.id)}
                       aria-label={`Select ${t.merchant}`}
                       onChange={() => onToggleSelected(t.id)} />
              ) },
            { key: 'date', header: 'Date',
              render: (t: Transaction) => t.transaction_date },
            { key: 'merchant', header: 'Merchant',
              render: (t: Transaction) => t.merchant },
            { key: 'cat', header: 'Category',
              render: (t: Transaction) => (
                <TransactionCategoryCell transaction={t} onAssign={row.assign} categoryOptionsFor={categoryOptionsFor} />
              ) },
            { key: 'amt', header: 'Amount', numeric: true,
              render: (t: Transaction) => <TransactionAmountCell transaction={t} /> },
            ...(matches === undefined ? [] : [{ key: 'recur', header: 'Recurring',
              render: (t: Transaction) => <TransactionRecurringCell transaction={t} matches={matches} busy={busy} /> }]),
            { key: 'actions', header: '',
              render: (t: Transaction) => (
                <TransactionActionsCell
                  transaction={t} onEdit={row.start} onDelete={row.remove} busy={busy}
                  summary={matches?.byId.get(t.id)}
                  pickerOpen={matches?.picker?.transactionId === t.id}
                  onToggleLink={matches === undefined ? undefined : toggleLink}
                />
              ) },
          ]}
          rows={items}
          rowKey={(t) => t.id}
          rowDetail={(t) => (
            matches !== undefined && matches.picker?.transactionId === t.id
              ? <TransactionRecurringPicker transaction={t} matches={matches} busy={busy} />
              : null
          )}
          empty={
            onlyUncategorized
              ? <EmptyState title="Nothing uncategorized" hint="Every transaction has a category." />
              : <EmptyState title="Nothing matches" hint="Widen the dates, clear the filters, or record a transaction." />
          }
        />
      </div>
    </>
  )
}
