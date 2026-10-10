import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../../api/client.js'
import type { TransactionMatchList, TransactionPage } from '../../../models/index.js'
import { deferred } from '../../../testing/deferred.js'
import { makeStatus } from '../../../testing/makeStatus.js'
import { makeTransaction } from '../../../testing/makeTransaction.js'
import { MATCHES_DEBOUNCE_MS, useTransactionMatches } from './useTransactionMatches.js'
import { useTransactionList } from './useTransactionList.js'

/**
 * How many requests the list and its recurring matches make across a page
 * turn and an edit, wired the way TransactionsPanel does.
 */

const rows = (...ids: string[]) => ids.map((id) => makeTransaction({ id, merchant: id }))
const pageOf = (ids: string[], nextCursor: string | null = null): TransactionPage => ({ items: rows(...ids), nextCursor })
const matchList = (...ids: string[]): TransactionMatchList => ({
  today: '2026-10-04',
  transactions: ids.map((transactionId) => ({ transactionId, linked: null, suggestion: null, dismissed: [] })),
})

const afterDebounce = () => new Promise((resolve) => setTimeout(resolve, MATCHES_DEBOUNCE_MS * 2))

function setup() {
  const status = makeStatus()
  return renderHook(() => {
    const list = useTransactionList(status)
    const matches = useTransactionMatches(list.items, status, list.revision)
    return { list, matches }
  })
}

type Get = { readonly mock: { readonly calls: readonly (readonly unknown[])[] } }
const urls = (get: Get, prefix: string) =>
  get.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith(prefix))
const listCalls = (get: Get) => urls(get, '/transactions?')
const matchCalls = (get: Get) => urls(get, '/recurring-items/transaction-matches?')

afterEach(() => { vi.restoreAllMocks() })

describe('recurring matches requests', () => {
  it('asks once per page turn, after the page that names the ids, and not again for an edit that changes nothing listed', async () => {
    const reread = deferred<TransactionPage>()
    const get = vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path.startsWith('/recurring-items/')) {
        return matchList(...new URLSearchParams(path.split('?')[1]).get('transactionIds')!.split(','))
      }
      if (path.includes('cursor=c2')) return pageOf(['c', 'd'])
      if (path.includes('withTotal') && listCalls(get).length > 2) return reread.promise
      return pageOf(['a', 'b'], 'c2')
    })
    const { result } = setup()

    // First page: one list request, then one matches request for its rows.
    await waitFor(() => { expect(matchCalls(get)).toHaveLength(1) })
    expect(listCalls(get)).toHaveLength(1)
    expect(matchCalls(get)[0]).toContain('transactionIds=a,b')

    // Page turn: one more of each.
    act(() => { result.current.list.goToNextPage() })
    await waitFor(() => { expect(matchCalls(get)).toHaveLength(2) })
    expect(listCalls(get)).toHaveLength(2)
    expect(matchCalls(get)[1]).toContain('transactionIds=c,d')

    // An edit re-reads the page. Its matches are requested at once, while the
    // list re-read is still in flight, because the ids are already known.
    let reloaded: Promise<void> = Promise.resolve()
    act(() => { reloaded = result.current.list.reload() })
    expect(listCalls(get)).toHaveLength(3)
    await waitFor(() => { expect(matchCalls(get)).toHaveLength(3) })
    expect(matchCalls(get)[2]).toContain('transactionIds=c,d')

    // The re-read returns the same rows: nothing further is asked.
    reread.resolve(pageOf(['c', 'd']))
    await act(async () => { await reloaded })
    await afterDebounce()
    expect(matchCalls(get)).toHaveLength(3)
    expect(listCalls(get)).toHaveLength(3)
  })

  it('asks once, for the page the user stops on, when paging through quickly', async () => {
    const get = vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path.startsWith('/recurring-items/')) return matchList('x')
      if (path.includes('cursor=c3')) return pageOf(['e', 'f'])
      if (path.includes('cursor=c2')) return pageOf(['c', 'd'], 'c3')
      return pageOf(['a', 'b'], 'c2')
    })
    const { result } = setup()
    await waitFor(() => { expect(matchCalls(get)).toHaveLength(1) })

    act(() => { result.current.list.goToNextPage() })
    await waitFor(() => { expect(result.current.list.items?.[0]?.id).toBe('c') })
    act(() => { result.current.list.goToNextPage() })
    await waitFor(() => { expect(result.current.list.items?.[0]?.id).toBe('e') })
    await afterDebounce()

    // Page 1's, then only the last page's: the page passed through is skipped.
    expect(matchCalls(get)).toHaveLength(2)
    expect(matchCalls(get)[1]).toContain('transactionIds=e,f')
  })

  it('ignores a matches response that arrives after a newer question', async () => {
    const slow = deferred<TransactionMatchList>()
    const get = vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path.startsWith('/recurring-items/')) {
        return path.includes('transactionIds=a,b') ? slow.promise : matchList('c')
      }
      if (path.includes('cursor=c2')) return pageOf(['c', 'd'])
      return pageOf(['a', 'b'], 'c2')
    })
    const { result } = setup()
    await waitFor(() => { expect(matchCalls(get)).toHaveLength(1) })

    act(() => { result.current.list.goToNextPage() })
    await waitFor(() => { expect(result.current.matches.byId.has('c')).toBe(true) })

    // The answer about the first page turns up late and must not replace the second's.
    await act(async () => { slow.resolve(matchList('a')) })
    expect([...result.current.matches.byId.keys()]).toEqual(['c'])
  })
})
