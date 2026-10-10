import { useCallback, useEffect, useState } from 'react'
import { api } from '../../../api/client.js'
import type { ActionStatus } from '../../../hooks/useActionStatus.js'
import { useLatestRequest } from '../../../hooks/useLatestRequest.js'
import type { Transaction, TransactionPage } from '../../../models/index.js'
import type { TransactionFilters } from '../state/TransactionFilters.js'

const DEFAULT_FILTERS: TransactionFilters = {
  search: '',
  from: '',
  to: '',
  accountId: '',
  categoryId: '',
  sort: 'date',
  direction: 'desc',
  onlyUncategorized: false,
}

/** What {@link useTransactionList} returns. */
export interface TransactionList {
  /** `null` until the first page has loaded. */
  readonly items: readonly Transaction[] | null
  /**
   * Number of transactions matching the filters across all pages, or `null`
   * until the first page has loaded. It is counted when the first page loads and
   * kept while paging, so it does not change as the user moves between pages.
   */
  readonly total: number | null
  /** The current filters and sort order. */
  readonly filters: TransactionFilters
  /** Page size. */
  readonly limit: number
  /** One-based number of the page being shown. */
  readonly pageNumber: number
  /** Whether there is an earlier page to go back to. */
  readonly hasPrevious: boolean
  /** Whether there is a later page. Always `false` until the current page has loaded. */
  readonly hasNext: boolean
  /** Ids of the selected rows. Always a subset of the rows currently listed. */
  readonly selected: ReadonlySet<string>
  /**
   * Merges a change into the filters and returns to the first page.
   *
   * Without the reset, narrowing a 1,200-row list to 30 while sitting on page 12
   * would show an empty table, which reads as "no results" for a filter that has
   * plenty.
   */
  readonly changeFilters: (patch: Partial<TransactionFilters>) => void
  /** Restores the default filters and returns to the first page. */
  readonly clearFilters: () => void
  /** Changes the page size and returns to the first page. */
  readonly changePageSize: (size: number) => void
  /** Shows the page after the current one. Does nothing on the last page. */
  readonly goToNextPage: () => void
  /** Shows the page before the current one. Does nothing on the first page. */
  readonly goToPreviousPage: () => void
  /** Selects or deselects one row. */
  readonly toggleSelected: (id: string) => void
  /** Selects every listed row, or clears the selection if all are already selected. */
  readonly toggleAllSelected: () => void
  /** Deselects every row. */
  readonly clearSelection: () => void
  /**
   * Counts how many times {@link TransactionList.reload} has been called. Things
   * derived from the listed rows (recurring matches) watch it to know the rows
   * were changed by the user, which re-reading the same rows does not show.
   */
  readonly revision: number
  /** Re-reads the current page. */
  readonly reload: () => Promise<void>
}

/**
 * Owns the transaction list: its filters, paging, current page and selection.

Paging is by cursor: each response carries the cursor of the page after it, and
the hook keeps the cursors of the pages already visited as a stack, so going back
re-requests an earlier page from its own cursor.
 *
 * @param status - Receives the message when a load fails.
 * @returns The current page, filters, paging and selection, with the actions that change them.
 */
export function useTransactionList(status: ActionStatus): TransactionList {
  const [items, setItems] = useState<Transaction[] | null>(null)
  const [total, setTotal] = useState<number | null>(null)
  const [filters, setFilters] = useState<TransactionFilters>(DEFAULT_FILTERS)
  const [limit, setLimit] = useState(50)
  // The cursors of the pages after the first, in the order they were visited.
  // Empty means the first page is showing.
  const [cursors, setCursors] = useState<readonly string[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [revision, setRevision] = useState(0)
  const { show } = status
  const cursor = cursors.at(-1) ?? null

  const latest = useLatestRequest()

  // Only the newest request may apply, so a slow page-1 response cannot
  // overwrite the page-2 list the user has since moved to.
  const load = useCallback(
    (withTotal: boolean) => {
      const p = new URLSearchParams()
      p.set('limit', String(limit))
      p.set('sort', filters.sort)
      p.set('direction', filters.direction)
      if (filters.onlyUncategorized) p.set('uncategorized', 'true')
      if (filters.search.trim() !== '') p.set('search', filters.search.trim())
      if (filters.from !== '') p.set('from', filters.from)
      if (filters.to !== '') p.set('to', filters.to)
      if (filters.accountId !== '') p.set('accountId', filters.accountId)
      if (filters.categoryId !== '') p.set('categoryId', filters.categoryId)
      if (cursor !== null) p.set('cursor', cursor)
      if (withTotal) p.set('withTotal', 'true')
      return latest.run(
        (signal) => api.get<TransactionPage>(`/transactions?${p.toString()}`, { signal }),
        (page) => {
          setItems(page.items)
          setNextCursor(page.nextCursor)
          if (page.total !== undefined) setTotal(page.total)
          // Anything no longer listed cannot be acted on, so drop it from the
          // selection rather than leaving invisible rows selected.
          setSelected((current) => new Set(page.items.filter((t) => current.has(t.id)).map((t) => t.id)))
        },
      )
    },
    [limit, filters, cursor, latest],
  )

  // The total is counted with the first page only. Counting costs a scan of
  // every matching row, and it cannot change by moving between pages.
  useEffect(() => {
    void load(cursor === null).catch((e: unknown) => {
      show(e instanceof Error ? e.message : 'Could not load transactions.')
    })
    // A changed query (or unmount) abandons the request in flight.
    return latest.cancel
  }, [load, cursor, latest, show])

  // After a change the user made (an edit, a delete, a new entry) the count may
  // be out of date, so re-read it along with the page.
  const reload = useCallback(() => {
    setRevision((r) => r + 1)
    return load(true)
  }, [load])

  const changeFilters = useCallback((patch: Partial<TransactionFilters>) => {
    setCursors([])
    setFilters((current) => ({ ...current, ...patch }))
  }, [])

  const clearFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS)
    setCursors([])
  }, [])

  const changePageSize = useCallback((size: number) => {
    setCursors([])
    setLimit(size)
  }, [])

  const goToNextPage = useCallback(() => {
    if (nextCursor === null) return
    // Clearing it disables "Next" until the new page says where it leads. The
    // check below covers a second click landing before that re-render: a cursor
    // names one position, so seeing it already on top means it was pushed.
    setNextCursor(null)
    setCursors((current) => (current.at(-1) === nextCursor ? current : [...current, nextCursor]))
  }, [nextCursor])

  const goToPreviousPage = useCallback(() => {
    setCursors((current) => current.slice(0, -1))
  }, [])

  const toggleSelected = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleAllSelected = useCallback(() => {
    const shown = items ?? []
    setSelected((current) =>
      shown.length > 0 && shown.every((t) => current.has(t.id))
        ? new Set()
        : new Set(shown.map((t) => t.id)),
    )
  }, [items])

  const clearSelection = useCallback(() => setSelected(new Set()), [])

  return {
    items, total, filters, limit, selected,
    pageNumber: cursors.length + 1,
    hasPrevious: cursors.length > 0,
    hasNext: nextCursor !== null,
    changeFilters, clearFilters, changePageSize, goToNextPage, goToPreviousPage,
    toggleSelected, toggleAllSelected, clearSelection, revision, reload,
  }
}
