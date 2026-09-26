import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../../api/client.js'
import type { TransactionPage } from '../../../models/index.js'
import { deferred } from '../../../testing/deferred.js'
import { makeStatus } from '../../../testing/makeStatus.js'
import { makeTransaction } from '../../../testing/makeTransaction.js'
import { useTransactionList } from './useTransactionList.js'

type Page = TransactionPage

const rows = (...ids: string[]) => ids.map((id) => makeTransaction({ id, merchant: id }))

/** A response page. `total` is only present when given, as the server only sends it when asked. */
const page = (ids: string[], extra: { nextCursor?: string | null; total?: number } = {}): Page => ({
  items: rows(...ids),
  nextCursor: extra.nextCursor ?? null,
  ...(extra.total === undefined ? {} : { total: extra.total }),
})

/** The query string of the n-th `/transactions` call (default: the latest). */
function queryOf(get: ReturnType<typeof vi.spyOn>, n = -1): URLSearchParams {
  const url = String(get.mock.calls.at(n)![0])
  expect(url.startsWith('/transactions?')).toBe(true)
  return new URLSearchParams(url.slice('/transactions?'.length))
}

function setup() {
  const status = makeStatus()
  const hook = renderHook(() => useTransactionList(status))
  return { ...hook, status }
}

afterEach(() => { vi.restoreAllMocks() })

describe('loading', () => {
  it('requests the first page with the default sort and shows it', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue(page(['a', 'b'], { total: 120 }))
    const { result } = setup()

    expect(result.current.items).toBeNull()
    await waitFor(() => { expect(result.current.items).toHaveLength(2) })

    expect(Object.fromEntries(queryOf(get))).toEqual({
      limit: '50', sort: 'date', direction: 'desc', withTotal: 'true',
    })
    expect(result.current.total).toBe(120)
  })

  it('reports a failed load through the status', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new Error('down'))
    const { status } = setup()

    await waitFor(() => { expect(status.show).toHaveBeenCalledWith('down') })
  })

  it('does not report an abandoned request as an error', async () => {
    const first = deferred<Page>()
    vi.spyOn(api, 'get').mockReturnValueOnce(first.promise).mockResolvedValue(page(['x']))
    const { result, status } = setup()

    act(() => result.current.changeFilters({ search: 'x' }))
    first.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    await waitFor(() => { expect(result.current.items).toHaveLength(1) })

    expect(status.show).not.toHaveBeenCalled()
  })

  it('passes an abort signal to the API and aborts it when the filters change', async () => {
    const get = vi.spyOn(api, 'get').mockReturnValue(new Promise(() => {}))
    const { result } = setup()
    const firstSignal = (get.mock.calls[0]![1] as { signal: AbortSignal }).signal
    expect(firstSignal.aborted).toBe(false)

    act(() => result.current.changeFilters({ search: 'x' }))

    expect(firstSignal.aborted).toBe(true)
  })

  it('aborts the request in flight on unmount', () => {
    const get = vi.spyOn(api, 'get').mockReturnValue(new Promise(() => {}))
    const { unmount } = setup()
    const signal = (get.mock.calls[0]![1] as { signal: AbortSignal }).signal

    unmount()

    expect(signal.aborted).toBe(true)
  })
})

describe('the query', () => {
  it('carries every active filter, trimming the search text', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue(page(['a']))
    const { result } = setup()
    await waitFor(() => { expect(result.current.items).not.toBeNull() })

    act(() => result.current.changeFilters({
      search: '  coffee ', from: '2026-01-01', to: '2026-01-31',
      accountId: 'acc-1', categoryId: 'cat-1', onlyUncategorized: true,
      sort: 'amount', direction: 'asc',
    }))
    await waitFor(() => { expect(queryOf(get).get('search')).toBe('coffee') })

    expect(Object.fromEntries(queryOf(get))).toEqual({
      limit: '50', sort: 'amount', direction: 'asc', uncategorized: 'true', withTotal: 'true',
      search: 'coffee', from: '2026-01-01', to: '2026-01-31', accountId: 'acc-1', categoryId: 'cat-1',
    })
  })

  it('leaves out blank filters', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue(page(['a']))
    const { result } = setup()
    await waitFor(() => { expect(result.current.items).not.toBeNull() })

    act(() => result.current.changeFilters({ search: '   ' }))

    await waitFor(() => { expect(queryOf(get).has('search')).toBe(false) })
  })

  it('goes back to the first page when a filter changes', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue(page(['a'], { nextCursor: 'c1', total: 500 }))
    const { result } = setup()
    await waitFor(() => { expect(result.current.hasNext).toBe(true) })
    act(() => result.current.goToNextPage())
    await waitFor(() => { expect(queryOf(get).get('cursor')).toBe('c1') })

    act(() => result.current.changeFilters({ accountId: 'acc-1' }))

    await waitFor(() => { expect(queryOf(get).get('accountId')).toBe('acc-1') })
    expect(queryOf(get).has('cursor')).toBe(false)
    expect(result.current.pageNumber).toBe(1)
  })

  it('goes back to the first page when the page size changes', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue(page(['a'], { nextCursor: 'c1', total: 500 }))
    const { result } = setup()
    await waitFor(() => { expect(result.current.hasNext).toBe(true) })
    act(() => result.current.goToNextPage())
    await waitFor(() => { expect(queryOf(get).get('cursor')).toBe('c1') })

    act(() => result.current.changePageSize(25))

    await waitFor(() => { expect(queryOf(get).get('limit')).toBe('25') })
    expect(queryOf(get).has('cursor')).toBe(false)
    expect(result.current.pageNumber).toBe(1)
  })

  it('restores the defaults and the first page when the filters are cleared', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue(page(['a'], { nextCursor: 'c1', total: 500 }))
    const { result } = setup()
    await waitFor(() => { expect(result.current.items).not.toBeNull() })
    act(() => result.current.changeFilters({ search: 'x', onlyUncategorized: true }))
    await waitFor(() => { expect(result.current.hasNext).toBe(true) })
    act(() => result.current.goToNextPage())
    await waitFor(() => { expect(queryOf(get).has('cursor')).toBe(true) })

    act(() => result.current.clearFilters())

    await waitFor(() => { expect(queryOf(get).has('search')).toBe(false) })
    expect(queryOf(get).has('uncategorized')).toBe(false)
    expect(queryOf(get).has('cursor')).toBe(false)
    expect(result.current.pageNumber).toBe(1)
    expect(result.current.filters.onlyUncategorized).toBe(false)
  })
})

describe('paging', () => {
  /** Serves three pages by cursor: first (no cursor) -> c2 -> c3 -> end. */
  function threePages() {
    return vi.spyOn(api, 'get').mockImplementation((url: string) => {
      const cursor = new URLSearchParams(url.split('?')[1]).get('cursor')
      const withTotal = new URLSearchParams(url.split('?')[1]).has('withTotal')
      const total = withTotal ? { total: 120 } : {}
      if (cursor === null) return Promise.resolve(page(['a1', 'a2'], { nextCursor: 'c2', ...total }))
      if (cursor === 'c2') return Promise.resolve(page(['b1', 'b2'], { nextCursor: 'c3', ...total }))
      return Promise.resolve(page(['c1'], total))
    })
  }
  const shown = (result: { current: { items: readonly { id: string }[] | null } }) => result.current.items?.map((t) => t.id)

  it('starts on page one with no earlier page', async () => {
    threePages()
    const { result } = setup()
    await waitFor(() => { expect(result.current.items).toHaveLength(2) })

    expect(result.current.pageNumber).toBe(1)
    expect(result.current.hasPrevious).toBe(false)
    expect(result.current.hasNext).toBe(true)
  })

  it('walks forward by the cursor each page returned', async () => {
    const get = threePages()
    const { result } = setup()
    await waitFor(() => { expect(result.current.hasNext).toBe(true) })

    act(() => result.current.goToNextPage())
    await waitFor(() => { expect(shown(result)).toEqual(['b1', 'b2']) })
    expect(queryOf(get).get('cursor')).toBe('c2')
    await waitFor(() => { expect(result.current.hasNext).toBe(true) })
    act(() => result.current.goToNextPage())
    await waitFor(() => { expect(shown(result)).toEqual(['c1']) })

    expect(queryOf(get).get('cursor')).toBe('c3')
    expect(result.current.pageNumber).toBe(3)
    expect(result.current.hasPrevious).toBe(true)
    expect(result.current.hasNext).toBe(false)
  })

  it('walks back through the pages it came from', async () => {
    const get = threePages()
    const { result } = setup()
    await waitFor(() => { expect(result.current.hasNext).toBe(true) })
    act(() => result.current.goToNextPage())
    await waitFor(() => { expect(result.current.hasNext && shown(result)?.[0] === 'b1').toBe(true) })
    act(() => result.current.goToNextPage())
    await waitFor(() => { expect(shown(result)).toEqual(['c1']) })

    act(() => result.current.goToPreviousPage())
    await waitFor(() => { expect(shown(result)).toEqual(['b1', 'b2']) })
    expect(queryOf(get).get('cursor')).toBe('c2')
    expect(result.current.pageNumber).toBe(2)

    await waitFor(() => { expect(result.current.hasPrevious).toBe(true) })
    act(() => result.current.goToPreviousPage())
    await waitFor(() => { expect(shown(result)).toEqual(['a1', 'a2']) })
    expect(queryOf(get).has('cursor')).toBe(false)
    expect(result.current.hasPrevious).toBe(false)
  })

  it('does nothing when there is no next page or no earlier page', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue(page(['a']))
    const { result } = setup()
    await waitFor(() => { expect(result.current.items).toHaveLength(1) })
    const calls = get.mock.calls.length

    act(() => result.current.goToNextPage())
    act(() => result.current.goToPreviousPage())

    expect(get.mock.calls).toHaveLength(calls)
    expect(result.current.pageNumber).toBe(1)
  })

  it('cannot push the same page twice when Next is clicked twice', async () => {
    const get = threePages()
    const { result } = setup()
    await waitFor(() => { expect(result.current.hasNext).toBe(true) })

    act(() => { result.current.goToNextPage(); result.current.goToNextPage() })
    await waitFor(() => { expect(shown(result)).toEqual(['b1', 'b2']) })

    expect(result.current.pageNumber).toBe(2)
    expect(get.mock.calls.filter(([url]) => String(url).includes('cursor=c2'))).toHaveLength(1)
  })

  it('counts on the first page only and keeps the total while paging', async () => {
    const get = threePages()
    const { result } = setup()
    await waitFor(() => { expect(result.current.total).toBe(120) })

    act(() => result.current.goToNextPage())
    await waitFor(() => { expect(shown(result)).toEqual(['b1', 'b2']) })

    expect(queryOf(get).has('withTotal')).toBe(false)
    expect(result.current.total).toBe(120)
  })

  it('counts again when the filters change', async () => {
    const get = threePages()
    const { result } = setup()
    await waitFor(() => { expect(result.current.total).toBe(120) })
    act(() => result.current.goToNextPage())
    await waitFor(() => { expect(shown(result)).toEqual(['b1', 'b2']) })

    act(() => result.current.changeFilters({ search: 'x' }))

    await waitFor(() => { expect(queryOf(get).get('search')).toBe('x') })
    expect(queryOf(get).get('withTotal')).toBe('true')
  })

  it('re-counts when a page is reloaded after a change, even beyond the first page', async () => {
    const get = threePages()
    const { result } = setup()
    await waitFor(() => { expect(result.current.hasNext).toBe(true) })
    act(() => result.current.goToNextPage())
    await waitFor(() => { expect(shown(result)).toEqual(['b1', 'b2']) })

    await act(async () => { await result.current.reload() })

    expect(queryOf(get).get('cursor')).toBe('c2')
    expect(queryOf(get).get('withTotal')).toBe('true')
  })

  it('has no total until the first page arrives', () => {
    vi.spyOn(api, 'get').mockReturnValue(new Promise(() => {}))
    const { result } = setup()

    expect(result.current.total).toBeNull()
  })
})

describe('the selection', () => {
  it('selects and deselects rows, and all of them at once', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(page(['a', 'b', 'c']))
    const { result } = setup()
    await waitFor(() => { expect(result.current.items).toHaveLength(3) })

    act(() => result.current.toggleSelected('a'))
    expect([...result.current.selected]).toEqual(['a'])
    act(() => result.current.toggleSelected('a'))
    expect(result.current.selected.size).toBe(0)

    act(() => result.current.toggleAllSelected())
    expect([...result.current.selected].sort()).toEqual(['a', 'b', 'c'])
    act(() => result.current.toggleAllSelected())
    expect(result.current.selected.size).toBe(0)

    act(() => result.current.toggleSelected('b'))
    act(() => result.current.clearSelection())
    expect(result.current.selected.size).toBe(0)
  })

  it('drops selected rows that are no longer listed after a reload', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue(page(['a', 'b', 'c']))
    const { result } = setup()
    await waitFor(() => { expect(result.current.items).toHaveLength(3) })
    act(() => result.current.toggleAllSelected())
    get.mockResolvedValue(page(['b', 'd']))

    await act(async () => { await result.current.reload() })

    expect([...result.current.selected]).toEqual(['b'])
    expect(result.current.items?.map((t) => t.id)).toEqual(['b', 'd'])
  })

  it('prunes the selection when the filters move to a different page of rows', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue(page(['a', 'b']))
    const { result } = setup()
    await waitFor(() => { expect(result.current.items).toHaveLength(2) })
    act(() => result.current.toggleAllSelected())
    get.mockResolvedValue(page(['z']))

    act(() => result.current.changeFilters({ search: 'z' }))

    await waitFor(() => { expect(result.current.items?.map((t) => t.id)).toEqual(['z']) })
    expect(result.current.selected.size).toBe(0)
  })
})

describe('stale responses', () => {
  it('ignores an older response that arrives after a newer one', async () => {
    const slow = deferred<Page>()
    const fast = deferred<Page>()
    vi.spyOn(api, 'get').mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise)
    const { result } = setup()

    act(() => result.current.changeFilters({ search: 'new' }))
    await act(async () => { fast.resolve(page(['new-1'], { total: 1 })) })
    await waitFor(() => { expect(result.current.items?.map((t) => t.id)).toEqual(['new-1']) })
    await act(async () => { slow.resolve(page(['old-1', 'old-2'], { total: 2 })) })

    expect(result.current.items?.map((t) => t.id)).toEqual(['new-1'])
    expect(result.current.total).toBe(1)
  })

  it('ignores an in-flight manual reload that a newer load has superseded', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue(page(['a']))
    const { result } = setup()
    await waitFor(() => { expect(result.current.items).toHaveLength(1) })

    const stale = deferred<Page>()
    get.mockReturnValueOnce(stale.promise)
    let reloading: Promise<void> = Promise.resolve()
    act(() => { reloading = result.current.reload() })
    get.mockResolvedValue(page(['fresh']))
    await act(async () => { await result.current.reload() })
    await act(async () => { stale.resolve(page(['stale'])); await reloading })

    expect(result.current.items?.map((t) => t.id)).toEqual(['fresh'])
  })
})
