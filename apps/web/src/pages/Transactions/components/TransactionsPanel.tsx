import { useCallback } from 'react'
import { Surface } from '@wickermoney/ui-kit'
import type { ActionStatus } from '../../../hooks/useActionStatus.js'
import type { ReferenceData } from '../hooks/useReferenceData.js'
import type { TransactionList } from '../hooks/useTransactionList.js'
import { categoryOptionsFor } from '../helpers/categoryOptionsFor.js'
import { TransactionFiltersForm } from './TransactionFiltersForm.js'
import { TransactionPager } from './TransactionPager.js'
import { TransactionTable } from './TransactionTable.js'
import { TriageBar } from './TriageBar.js'

/** Props for {@link TransactionsPanel}. */
export interface TransactionsPanelProps {
  /** The transaction list state and actions. */
  readonly list: TransactionList
  /** The accounts and categories the pickers offer. */
  readonly reference: ReferenceData
  /** Busy flag and error message shared with the page. */
  readonly status: ActionStatus
}

/** The filterable, pageable transaction list: filters, triage controls, table and pager. */
export function TransactionsPanel({ list, reference, status }: TransactionsPanelProps) {
  const { accounts, categories, enabledCategories } = reference
  const { filters, items } = list

  const optionsFor = useCallback(
    (currentId: string | null) => categoryOptionsFor(categories, enabledCategories, currentId),
    [categories, enabledCategories],
  )

  return (
    <Surface title={filters.onlyUncategorized ? 'Uncategorized' : 'Transactions'}>
      <TransactionFiltersForm
        filters={filters}
        accounts={accounts}
        enabledCategories={enabledCategories}
        busy={status.busy}
        onChange={list.changeFilters}
        onClear={list.clearFilters}
      />

      <TriageBar
        onlyUncategorized={filters.onlyUncategorized}
        onOnlyUncategorizedChange={(checked) => list.changeFilters({ onlyUncategorized: checked })}
        selectedIds={list.selected}
        enabledCategories={enabledCategories}
        status={status}
        onApplied={async () => { list.clearSelection(); await list.reload() }}
      />

      <TransactionTable
        items={items}
        selected={list.selected}
        onlyUncategorized={filters.onlyUncategorized}
        categoryOptionsFor={optionsFor}
        status={status}
        onToggleSelected={list.toggleSelected}
        onToggleAllSelected={list.toggleAllSelected}
        onChanged={list.reload}
      />

      <TransactionPager
        total={list.total}
        limit={list.limit}
        pageNumber={list.pageNumber}
        hasPrevious={list.hasPrevious}
        hasNext={list.hasNext}
        busy={status.busy}
        onPageSizeChange={list.changePageSize}
        onPrevious={list.goToPreviousPage}
        onNext={list.goToNextPage}
      />
    </Surface>
  )
}
