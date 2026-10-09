import { act, renderHook, waitFor } from '@testing-library/react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { BUDGETS_API_BASE } from '../../server/constants.js'
import type { AccountLine, AccountOption, MonthResponse } from '../models/index.js'
import type { MockApi } from '../testing/MockApi.js'
import { makeApi } from '../testing/makeApi.js'
import { makeCtx } from '../testing/makeCtx.js'
import { useBudgetMonth } from './useBudgetMonth.js'

const ACCOUNTS: AccountOption[] = [
  { id: 'a1', name: 'Joint Checking', type: 'checking' },
  { id: 'a2', name: 'Holiday Savings', type: 'savings' },
]

const MONTH: MonthResponse = {
  monthKey: '2026-06', period: { start: '2026-06-01', end: '2026-07-01' }, today: '2026-06-15',
  draft: false, lines: [], unbudgeted: [],
  summary: {
    planned: '0.0000', available: '0.0000', spent: '0.0000', remaining: '0.0000',
    unbudgetedSpent: '0.0000', overCount: 0, atRiskCount: 0,
  },
}

function serve(api: MockApi, options: { accounts?: Promise<unknown> } = {}): void {
  api.get.mockImplementation((path: string) => {
    if (path.startsWith('/core/categories')) return Promise.resolve([])
    if (path.startsWith('/core/accounts')) return options.accounts ?? Promise.resolve({ accounts: ACCOUNTS })
    return Promise.resolve(MONTH)
  })
}

beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-06-15T12:00:00Z') }) })
afterAll(() => { vi.useRealTimers() })

describe('useBudgetMonth account allowances', () => {
  it('offers checking accounts only', async () => {
    const api = makeApi()
    serve(api)
    const { result } = renderHook(() => useBudgetMonth(makeCtx(api)))
    await waitFor(() => expect(result.current.month).not.toBeNull())
    expect(result.current.accounts.map((a) => a.name)).toEqual(['Joint Checking'])
  })

  it('still loads the month when the host cannot list accounts', async () => {
    const api = makeApi()
    serve(api, { accounts: Promise.reject(new Error('403')) })
    const { result } = renderHook(() => useBudgetMonth(makeCtx(api)))
    await waitFor(() => expect(result.current.month).not.toBeNull())
    expect(result.current.accounts).toEqual([])
    expect(result.current.message).toBeNull()
  })

  it('saves the allowance for the month shown, then reloads', async () => {
    const api = makeApi()
    serve(api)
    api.put.mockResolvedValue({})
    const { result } = renderHook(() => useBudgetMonth(makeCtx(api)))
    await waitFor(() => expect(result.current.month).not.toBeNull())

    let errors: unknown
    await act(async () => {
      errors = await result.current.saveAccountLine({
        accountId: 'a1', planned: '150.00', rollover: true, excludedCategoryIds: ['c1'], note: null,
      })
    })

    expect(errors).toEqual({ fields: {}, form: null })
    expect(api.put).toHaveBeenCalledWith(`${BUDGETS_API_BASE}/account-line`, {
      month: '2026-06', accountId: 'a1', planned: '150.00', rollover: true, excludedCategoryIds: ['c1'], note: null,
    })
  })

  it('refuses a bad amount without calling the server', async () => {
    const api = makeApi()
    serve(api)
    const { result } = renderHook(() => useBudgetMonth(makeCtx(api)))
    await waitFor(() => expect(result.current.month).not.toBeNull())

    let errors: { fields: Record<string, string> } | undefined
    await act(async () => {
      errors = await result.current.saveAccountLine({
        accountId: 'a1', planned: '-5', rollover: true, excludedCategoryIds: [], note: null,
      })
    })

    expect(errors?.fields['planned']).toBeTruthy()
    expect(api.put).not.toHaveBeenCalled()
  })

  it('removes the allowance for the month shown', async () => {
    const api = makeApi()
    serve(api)
    api.del.mockResolvedValue({ removed: 1 })
    const { result } = renderHook(() => useBudgetMonth(makeCtx(api)))
    await waitFor(() => expect(result.current.month).not.toBeNull())

    await act(async () => { await result.current.removeAccountLine({ accountId: 'a1' } as AccountLine) })

    expect(api.del).toHaveBeenCalledWith(`${BUDGETS_API_BASE}/account-line?month=2026-06&accountId=a1`)
  })
})
