import { useState } from 'react'
import { Button, CategoryOptions, Field, SelectField } from '@wickermoney/ui-kit'
import type { Account, Category } from '../../../models/index.js'
import type { SortDirection } from '../state/SortDirection.js'
import type { SortField } from '../state/SortField.js'
import type { TransactionFilters } from '../state/TransactionFilters.js'

/** Props for {@link TransactionFiltersForm}. */
export interface TransactionFiltersFormProps {
  /** The current filter values. */
  readonly filters: TransactionFilters
  /** Accounts offered in the account filter. */
  readonly accounts: readonly Account[]
  /** Only enabled categories are offered, like every other picker on the page. */
  readonly enabledCategories: readonly Category[]
  /** `true` while a request is in flight; disables the controls. */
  readonly busy: boolean
  /** Merges a change into the filters and returns to the first page. */
  readonly onChange: (patch: Partial<TransactionFilters>) => void
  /** Restores the default filters. */
  readonly onClear: () => void
}

/** The search, date, account, category and sort controls above the transaction list. */
export function TransactionFiltersForm({
  filters, accounts, enabledCategories, busy, onChange, onClear,
}: TransactionFiltersFormProps) {
  // Typed text is held locally and only applied on submit, so each keystroke
  // does not trigger a request.
  const [search, setSearch] = useState(filters.search)

  return (
    <form
      className="txn__filters"
      onSubmit={(e) => { e.preventDefault(); onChange({ search }) }}
    >
      <Field
        label="Search merchant"
        value={search}
        placeholder="COFFEE"
        onChange={(e) => setSearch(e.target.value)}
      />
      <Field label="From" type="date" value={filters.from}
             onChange={(e) => onChange({ from: e.target.value })} />
      <Field label="To" type="date" value={filters.to}
             onChange={(e) => onChange({ to: e.target.value })} />
      <SelectField label="Account" value={filters.accountId}
                   onChange={(e) => onChange({ accountId: e.target.value })}>
        <option value="">All accounts</option>
        {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </SelectField>
      <SelectField label="Category" value={filters.categoryId}
                   onChange={(e) => onChange({ categoryId: e.target.value })}>
        <CategoryOptions
          categories={enabledCategories}
          placeholder={{ value: '', label: 'All categories' }}
          includesChildren
        />
      </SelectField>
      <SelectField label="Sort by" value={`${filters.sort}:${filters.direction}`}
                   onChange={(e) => {
                     const [s, d] = e.target.value.split(':')
                     onChange({ sort: s as SortField, direction: d as SortDirection })
                   }}>
        <option value="date:desc">Newest first</option>
        <option value="date:asc">Oldest first</option>
        <option value="amount:asc">Largest spend</option>
        <option value="amount:desc">Largest income</option>
        <option value="merchant:asc">Merchant A–Z</option>
      </SelectField>
      <div className="txn__filter-actions">
        <Button type="submit" disabled={busy}>Search</Button>
        <Button
          type="button"
          disabled={busy}
          onClick={() => { setSearch(''); onClear() }}
        >
          Clear
        </Button>
      </div>
    </form>
  )
}
