import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PluginApi, PluginContext } from '@wickermoney/plugin-sdk'
import type { SummaryResponse, SummaryRow } from '../models/index.js'
import { useMonthlySummary } from './useMonthlySummary.js'

type Get = (path: string, init?: RequestInit) => Promise<unknown>

const rowsFor = (name: string): SummaryRow[] => [
  { month: '2026-07', categoryId: name, categoryName: name, kind: 'expense', total: '1.00' },
]

const answer = (name: string, months: number): SummaryResponse => ({ months, rows: rowsFor(name) })

interface Pending {
  readonly promise: Promise<SummaryResponse>
  readonly resolve: (value: SummaryResponse) => void
  readonly reject: (reason: Error) => void
}

function pending(): Pending {
  let resolve!: (value: SummaryResponse) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<SummaryResponse>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** A context around one mocked `get`; each call builds a new context object, like a host that rebuilds it per render. */
function contextFactory(get: ReturnType<typeof vi.fn<Get>>): () => PluginContext {
  const api = { get, post: vi.fn(), put: vi.fn(), del: vi.fn() } as unknown as PluginApi
  return () => ({
    session: { userId: 'u', email: 'u@example.com', timezone: 'UTC' },
    api,
    navigate: vi.fn(),
    formatMoney: (v) => v,
    formatDate: (v) => v,
  })
}

describe('useMonthlySummary', () => {
  it('starts loading, then delivers the rows', async () => {
    const get = vi.fn<Get>().mockResolvedValue(answer('Food', 12))
    const ctx = contextFactory(get)

    const { result } = renderHook(() => useMonthlySummary(ctx()))

    expect(result.current).toEqual({ rows: [], loading: true, error: null })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.rows).toEqual(rowsFor('Food'))
    expect(get).toHaveBeenCalledWith('/core/transactions/monthly-summary?months=12', {
      signal: expect.any(AbortSignal) as AbortSignal,
    })
  })

  it('reports a failure and no rows', async () => {
    const get = vi.fn<Get>().mockRejectedValue(new Error('403'))

    const ctx = contextFactory(get)

    const { result } = renderHook(() => useMonthlySummary(ctx()))

    await waitFor(() => expect(result.current.error).toBe('403'))
    expect(result.current).toMatchObject({ rows: [], loading: false })
  })

  it('falls back to a plain message for a failure that is not an Error', async () => {
    const get = vi.fn<Get>().mockRejectedValue('nope')

    const ctx = contextFactory(get)

    const { result } = renderHook(() => useMonthlySummary(ctx()))

    await waitFor(() => expect(result.current.error).toBe('Could not load spending data.'))
  })

  it('does not refetch when the host rebuilds the context around the same client', async () => {
    const get = vi.fn<Get>().mockResolvedValue(answer('Food', 12))
    const ctx = contextFactory(get)

    const { result, rerender } = renderHook(() => useMonthlySummary(ctx()))
    await waitFor(() => expect(result.current.loading).toBe(false))
    rerender()
    rerender()

    expect(get).toHaveBeenCalledTimes(1)
  })

  it('lets a slow response for an earlier range lose to the newer one', async () => {
    const three = pending()
    const six = pending()
    const get = vi.fn<Get>().mockReturnValueOnce(three.promise).mockReturnValueOnce(six.promise)
    const ctx = contextFactory(get)

    const { result, rerender } = renderHook(({ months }) => useMonthlySummary(ctx(), months), {
      initialProps: { months: 3 },
    })
    rerender({ months: 6 })
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2))

    await act(async () => { six.resolve(answer('Newer', 6)) })
    await waitFor(() => expect(result.current.rows).toEqual(rowsFor('Newer')))
    await act(async () => { three.resolve(answer('Older', 3)) })

    expect(result.current.rows).toEqual(rowsFor('Newer'))
  })

  it('ignores the failure of a request that was superseded', async () => {
    const three = pending()
    const get = vi.fn<Get>()
      .mockReturnValueOnce(three.promise)
      .mockResolvedValueOnce(answer('Newer', 6))
    const ctx = contextFactory(get)

    const { result, rerender } = renderHook(({ months }) => useMonthlySummary(ctx(), months), {
      initialProps: { months: 3 },
    })
    rerender({ months: 6 })
    await waitFor(() => expect(result.current.rows).toEqual(rowsFor('Newer')))
    await act(async () => { three.reject(new Error('late failure')) })

    expect(result.current.error).toBeNull()
  })

  it('shows loading again while a new range is fetched', async () => {
    const six = pending()
    const get = vi.fn<Get>().mockResolvedValueOnce(answer('Food', 3)).mockReturnValueOnce(six.promise)
    const ctx = contextFactory(get)

    const { result, rerender } = renderHook(({ months }) => useMonthlySummary(ctx(), months), {
      initialProps: { months: 3 },
    })
    await waitFor(() => expect(result.current.loading).toBe(false))
    rerender({ months: 6 })

    await waitFor(() => expect(result.current.loading).toBe(true))
    await act(async () => { six.resolve(answer('Food', 6)) })
    expect(result.current.loading).toBe(false)
  })

  it('aborts the request in flight on unmount', async () => {
    const get = vi.fn<Get>().mockReturnValue(pending().promise)

    const ctx = contextFactory(get)

    const { unmount } = renderHook(() => useMonthlySummary(ctx()))
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1))
    const init = get.mock.calls[0]?.[1]

    unmount()

    expect(init?.signal?.aborted).toBe(true)
  })
})
