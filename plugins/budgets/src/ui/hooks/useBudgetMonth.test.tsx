import { act, renderHook, waitFor } from '@testing-library/react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { BUDGETS_API_BASE } from '../../server/constants.js'
import type { Category, MonthResponse } from '../models/index.js'
import { deferred } from '../testing/deferred.js'
import type { MockApi } from '../testing/MockApi.js'
import { makeApi } from '../testing/makeApi.js'
import { makeCtx } from '../testing/makeCtx.js'
import { useBudgetMonth } from './useBudgetMonth.js'

const CATEGORIES: Category[] = [{ id: 'c1', name: 'Groceries', parent_id: null }]

function monthResponse(monthKey: string): MonthResponse {
  return {
    monthKey, period: { start: `${monthKey}-01`, end: `${monthKey}-28` }, today: `${monthKey}-10`,
    draft: false, lines: [], unbudgeted: [],
    summary: {
      planned: '0.0000', available: '0.0000', spent: '0.0000', remaining: '0.0000',
      unbudgetedSpent: '0.0000', overCount: 0, atRiskCount: 0,
    },
  }
}

/** Answers month requests from the map by month key, and category requests immediately. */
function serve(api: MockApi, months: Record<string, Promise<MonthResponse>>): void {
  api.get.mockImplementation((path: string) => {
    if (path.startsWith('/core/categories')) return Promise.resolve(CATEGORIES)
    const key = /month=(\d{4}-\d{2})/.exec(path)?.[1] ?? ''
    return months[key] ?? Promise.reject(new Error(`unexpected ${path}`))
  })
}

const monthCalls = (api: MockApi): string[] =>
  api.get.mock.calls.map((c) => String(c[0])).filter((p) => p.includes('/month?'))

const monthUrl = (key: string, tz = 'UTC'): string =>
  `${BUDGETS_API_BASE}/month?month=${key}&tz=${encodeURIComponent(tz)}`

const line = { id: 'l1', categoryId: 'c1', categoryName: 'Groceries', note: null } as never

// Fixes only the date, so the starting month is 2026-06 and timers stay real.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-06-15T12:00:00Z') })
})
afterAll(() => {
  vi.useRealTimers()
})

describe('useBudgetMonth loading', () => {
  it('loads the current month in the user\'s zone, with the categories', async () => {
    const api = makeApi()
    serve(api, { '2026-06': Promise.resolve(monthResponse('2026-06')) })

    const { result } = renderHook(() => useBudgetMonth(makeCtx(api, 'Europe/London')))

    expect(result.current.month).toBeNull()
    await waitFor(() => expect(result.current.month?.monthKey).toBe('2026-06'))
    expect(result.current.categories).toEqual(CATEGORIES)
    expect(api.get).toHaveBeenCalledWith(monthUrl('2026-06', 'Europe/London'), {
      signal: expect.any(AbortSignal) as AbortSignal,
    })
  })

  it('offers only categories a budget can count, not income or transfers', async () => {
    const api = makeApi()
    api.get.mockImplementation((path: string) =>
      path.startsWith('/core/categories')
        ? Promise.resolve([
            { id: 'c1', name: 'Groceries', parent_id: null, kind: 'expense' },
            { id: 'c2', name: 'Salary', parent_id: null, kind: 'income' },
            { id: 'c3', name: 'Between accounts', parent_id: null, kind: 'transfer' },
          ])
        : Promise.resolve(monthResponse('2026-06')))

    const { result } = renderHook(() => useBudgetMonth(makeCtx(api)))

    await waitFor(() => expect(result.current.month).not.toBeNull())
    expect(result.current.categories.map((c) => c.name)).toEqual(['Groceries'])
  })

  it('reports a failed load and shows no month', async () => {
    const api = makeApi()
    serve(api, { '2026-06': Promise.reject(new Error('boom')) })

    const { result } = renderHook(() => useBudgetMonth(makeCtx(api)))

    await waitFor(() => expect(result.current.message).toBe('boom'))
    expect(result.current.month).toBeNull()
  })

  it('does not refetch when the host hands over a new context object with the same client', async () => {
    const api = makeApi()
    serve(api, { '2026-06': Promise.resolve(monthResponse('2026-06')) })

    const { result, rerender } = renderHook(() => useBudgetMonth(makeCtx(api)))
    await waitFor(() => expect(result.current.month).not.toBeNull())

    rerender()
    rerender()

    expect(monthCalls(api)).toHaveLength(1)
  })

  it('refetches when the user\'s time zone changes', async () => {
    const api = makeApi()
    serve(api, { '2026-06': Promise.resolve(monthResponse('2026-06')) })

    const { result, rerender } = renderHook(({ tz }) => useBudgetMonth(makeCtx(api, tz)), {
      initialProps: { tz: 'UTC' },
    })
    await waitFor(() => expect(result.current.month).not.toBeNull())

    rerender({ tz: 'Asia/Tokyo' })

    await waitFor(() => expect(monthCalls(api)).toEqual([monthUrl('2026-06'), monthUrl('2026-06', 'Asia/Tokyo')]))
  })

  it('aborts the request that is in flight when the page goes away', async () => {
    const api = makeApi()
    serve(api, { '2026-06': deferred<MonthResponse>().promise })

    const { unmount } = renderHook(() => useBudgetMonth(makeCtx(api)))
    await waitFor(() => expect(monthCalls(api)).toHaveLength(1))
    const init = api.get.mock.calls[0]?.[1] as RequestInit

    unmount()

    expect(init.signal?.aborted).toBe(true)
  })
})

describe('useBudgetMonth stale responses', () => {
  it('lets a slow earlier month lose to the month the user moved to', async () => {
    const june = deferred<MonthResponse>()
    const july = deferred<MonthResponse>()
    const api = makeApi()
    serve(api, { '2026-06': june.promise, '2026-07': july.promise })

    const { result } = renderHook(() => useBudgetMonth(makeCtx(api)))
    await waitFor(() => expect(monthCalls(api)).toHaveLength(1))
    act(() => result.current.nextMonth())
    await waitFor(() => expect(monthCalls(api)).toHaveLength(2))

    await act(async () => { july.resolve(monthResponse('2026-07')) })
    await waitFor(() => expect(result.current.month?.monthKey).toBe('2026-07'))
    await act(async () => { june.resolve(monthResponse('2026-06')) })

    expect(result.current.monthKey).toBe('2026-07')
    expect(result.current.month?.monthKey).toBe('2026-07')
  })

  it('does not surface the error of a request that was superseded', async () => {
    const june = deferred<MonthResponse>()
    const api = makeApi()
    serve(api, { '2026-06': june.promise, '2026-07': Promise.resolve(monthResponse('2026-07')) })

    const { result } = renderHook(() => useBudgetMonth(makeCtx(api)))
    await waitFor(() => expect(monthCalls(api)).toHaveLength(1))
    act(() => result.current.nextMonth())
    await waitFor(() => expect(result.current.month?.monthKey).toBe('2026-07'))

    await act(async () => { june.reject(new Error('aborted late')) })

    expect(result.current.message).toBeNull()
    expect(result.current.month?.monthKey).toBe('2026-07')
  })

  it('does not reload the month the user left when a save finishes after they moved on', async () => {
    const saving = deferred<unknown>()
    const api = makeApi()
    serve(api, {
      '2026-06': Promise.resolve(monthResponse('2026-06')),
      '2026-07': Promise.resolve(monthResponse('2026-07')),
    })
    api.put.mockReturnValue(saving.promise)

    const { result } = renderHook(() => useBudgetMonth(makeCtx(api)))
    await waitFor(() => expect(result.current.month?.monthKey).toBe('2026-06'))

    let saved: Promise<void> = Promise.resolve()
    act(() => { saved = result.current.save(line, '50', false) })
    act(() => result.current.nextMonth())
    await waitFor(() => expect(result.current.month?.monthKey).toBe('2026-07'))
    await act(async () => {
      saving.resolve({})
      await saved
    })

    expect(monthCalls(api)).toEqual([monthUrl('2026-06'), monthUrl('2026-07')])
    expect(result.current.month?.monthKey).toBe('2026-07')
    expect(result.current.busy).toBe(false)
  })
})

describe('useBudgetMonth actions', () => {
  async function loaded(): Promise<{ api: MockApi; hook: ReturnType<typeof renderHook<ReturnType<typeof useBudgetMonth>, unknown>> }> {
    const api = makeApi()
    serve(api, { '2026-06': Promise.resolve(monthResponse('2026-06')) })
    const hook = renderHook(() => useBudgetMonth(makeCtx(api)))
    await waitFor(() => expect(hook.result.current.month).not.toBeNull())
    return { api, hook }
  }

  it('saves a line and reloads the month', async () => {
    const { api, hook } = await loaded()
    api.put.mockResolvedValue({})

    await act(() => hook.result.current.save(line, '75.00', true))

    expect(api.put).toHaveBeenCalledWith(`${BUDGETS_API_BASE}/line`, {
      month: '2026-06', categoryId: 'c1', planned: '75.00', rollover: true, note: null,
    })
    expect(monthCalls(api)).toHaveLength(2)
  })

  it('refuses a plan that is not an amount without calling the server', async () => {
    const { api, hook } = await loaded()

    await act(() => hook.result.current.save(line, 'abc', false))

    expect(api.put).not.toHaveBeenCalled()
    expect(hook.result.current.message).toBe("'abc' is not an amount.")
  })

  it('shows the server\'s message when a save fails, and stops being busy', async () => {
    const { api, hook } = await loaded()
    api.put.mockRejectedValue(new Error('nope'))

    await act(() => hook.result.current.save(line, '10', false))

    expect(hook.result.current.message).toBe('nope')
    expect(hook.result.current.busy).toBe(false)
  })

  it('removes a line by month and category', async () => {
    const { api, hook } = await loaded()
    api.del.mockResolvedValue({ removed: 1 })

    await act(() => hook.result.current.remove(line))

    expect(api.del).toHaveBeenCalledWith(`${BUDGETS_API_BASE}/line?month=2026-06&categoryId=c1`)
  })

  it('removes a window as a whole, by id, whichever month is shown', async () => {
    const { api, hook } = await loaded()
    api.del.mockResolvedValue({ removed: 1 })
    const window = {
      ...(line as object),
      id: 'w1',
      window: { start: '2026-05-01', through: '2026-07-04', funded: '900.0000', spentToDate: '0.0000' },
    } as never

    await act(() => hook.result.current.remove(window))

    expect(api.del).toHaveBeenCalledWith(`${BUDGETS_API_BASE}/window?id=w1`)
  })

  it('saves a window and reports success so the form can clear', async () => {
    const { api, hook } = await loaded()
    api.put.mockResolvedValue({})
    const draft = {
      id: null, categoryId: 'c1', start: '2026-10-01', through: '2026-12-25', planned: '1500', note: null,
    }

    let saved = false
    await act(async () => { saved = await hook.result.current.saveWindow(draft) })

    expect(saved).toBe(true)
    expect(api.put).toHaveBeenCalledWith(`${BUDGETS_API_BASE}/window`, draft)
  })

  it('reports a refused window and keeps the form', async () => {
    const { api, hook } = await loaded()
    api.put.mockRejectedValue(new Error('This category already has a budget line on some of those days.'))

    let saved = true
    await act(async () => {
      saved = await hook.result.current.saveWindow({
        id: null, categoryId: 'c1', start: '2026-10-01', through: '2026-12-25', planned: '10', note: null,
      })
    })

    expect(saved).toBe(false)
    expect(hook.result.current.message).toMatch(/already has a budget line/)
    expect(hook.result.current.busy).toBe(false)
  })

  it('adopts the previous month and says how many lines came across', async () => {
    const { api, hook } = await loaded()
    api.post.mockResolvedValue({ created: 3 })

    await act(() => hook.result.current.adopt())

    expect(api.post).toHaveBeenCalledWith(`${BUDGETS_API_BASE}/month/adopt`, { month: '2026-06' })
    expect(hook.result.current.message).toBe('3 lines carried over from May 2026.')
  })

  it('adds a zero-plan line, and ignores an empty category choice', async () => {
    const { api, hook } = await loaded()
    api.put.mockResolvedValue({})

    await act(() => hook.result.current.addLine(''))
    expect(api.put).not.toHaveBeenCalled()

    await act(() => hook.result.current.addLine('c1'))
    expect(api.put).toHaveBeenCalledWith(`${BUDGETS_API_BASE}/line`, {
      month: '2026-06', categoryId: 'c1', planned: '0.0000', rollover: false,
    })
  })

  it('keeps unsaved edits until the month reloads, then drops them', async () => {
    const { api, hook } = await loaded()
    api.put.mockResolvedValue({})

    act(() => hook.result.current.editPlan('c1', '12'))
    expect(hook.result.current.edits).toEqual({ c1: '12' })

    await act(() => hook.result.current.save(line, '12', false))
    expect(hook.result.current.edits).toEqual({})
  })

  it('steps between months and back to this one', async () => {
    const { hook } = await loaded()

    act(() => hook.result.current.previousMonth())
    expect(hook.result.current.monthKey).toBe('2026-05')
    act(() => hook.result.current.nextMonth())
    act(() => hook.result.current.nextMonth())
    expect(hook.result.current.monthKey).toBe('2026-07')
    act(() => hook.result.current.thisMonth())
    expect(hook.result.current.monthKey).toBe('2026-06')
  })
})
