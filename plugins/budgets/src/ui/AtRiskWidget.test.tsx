import { act, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BUDGETS_API_BASE } from '../server/constants.js'
import AtRiskWidget from './AtRiskWidget.js'
import type { AtRiskResponse, MonthLine } from './models/index.js'
import { deferred } from './testing/deferred.js'
import { makeApi } from './testing/makeApi.js'
import { makeCtx } from './testing/makeCtx.js'

const overLine: MonthLine = {
  id: 'l1', categoryId: 'c1', categoryName: 'Dining', planned: '100.0000', carriedIn: '0.0000',
  available: '100.0000', spent: '130.0000', remaining: '-30.0000', rollover: false,
  used: 1.3, pace: 2.6, health: 'over', note: null, draft: false,
}

const atRisk = (overrides: Partial<AtRiskResponse> = {}): AtRiskResponse => ({
  monthKey: '2026-06', today: '2026-06-15', planned: true, total: 3, lines: [overLine],
  summary: { spent: '130.0000', available: '100.0000' },
  ...overrides,
})

describe('AtRiskWidget', () => {
  it('asks for the at-risk lines in the user\'s zone and lists them worst first', async () => {
    const api = makeApi()
    api.get.mockResolvedValue(atRisk())

    render(<AtRiskWidget ctx={makeCtx(api, 'Europe/London')} size="md" />)

    expect(await screen.findByText('Dining')).toBeTruthy()
    expect(screen.getByText('$30.0000 over')).toBeTruthy()
    expect(screen.getByText(/1 of 3 lines need attention/)).toBeTruthy()
    expect(api.get).toHaveBeenCalledWith(`${BUDGETS_API_BASE}/at-risk?tz=Europe%2FLondon`, {
      signal: expect.any(AbortSignal) as AbortSignal,
    })
  })

  it('shows the whole breakdown when the server sends one, with the month\'s totals and a way to the page', async () => {
    const fine: MonthLine = {
      ...overLine, id: 'l2', categoryId: 'c2', categoryName: 'Groceries', available: '450.0000',
      planned: '450.0000', spent: '312.0000', remaining: '138.0000', used: 312 / 450, pace: 1, health: 'on-track',
    }
    const api = makeApi()
    api.get.mockResolvedValue(atRisk({ total: 9, breakdown: [overLine, fine], summary: { spent: '442.0000', available: '550.0000' } }))
    const ctx = makeCtx(api)

    render(<AtRiskWidget ctx={ctx} size="md" />)

    expect(await screen.findByText('Groceries')).toBeTruthy()
    expect(screen.getByText('$138.0000 left')).toBeTruthy()
    expect(screen.getByText(/1 of 9 lines need attention\. \$442\.0000 of \$550\.0000 spent\./)).toBeTruthy()
    act(() => { screen.getByRole('button', { name: 'All 9 lines' }).click() })
    expect(ctx.navigate).toHaveBeenCalledWith('/p/wickermoney.budgets/budgets')
  })

  it('says every line is on pace under a breakdown with nothing over', async () => {
    const api = makeApi()
    api.get.mockResolvedValue(atRisk({ lines: [], total: 1, breakdown: [{ ...overLine, remaining: '10.0000', health: 'on-track' }] }))

    render(<AtRiskWidget ctx={makeCtx(api)} size="md" />)

    expect(await screen.findByText(/All 1 budget lines are on pace\./)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /lines$/ })).toBeNull()
  })

  it('says so when the month has no budget', async () => {
    const api = makeApi()
    api.get.mockResolvedValue(atRisk({ planned: false, lines: [] }))

    render(<AtRiskWidget ctx={makeCtx(api)} size="md" />)

    expect(await screen.findByText('No budget this month')).toBeTruthy()
  })

  it('says every line is on pace when none needs attention', async () => {
    const api = makeApi()
    api.get.mockResolvedValue(atRisk({ lines: [], total: 4 }))

    render(<AtRiskWidget ctx={makeCtx(api)} size="md" />)

    expect(await screen.findByText(/All 4 budget lines are on pace/)).toBeTruthy()
  })

  it('shows a failed load as unavailable rather than crashing', async () => {
    const api = makeApi()
    api.get.mockRejectedValue(new Error('down'))

    render(<AtRiskWidget ctx={makeCtx(api)} size="md" />)

    expect(await screen.findByText('Budgets unavailable')).toBeTruthy()
    expect(screen.getByText('down')).toBeTruthy()
  })

  it('does not refetch when the host rebuilds the context around the same client', async () => {
    const api = makeApi()
    api.get.mockResolvedValue(atRisk())

    const { rerender } = render(<AtRiskWidget ctx={makeCtx(api)} size="md" />)
    await screen.findByText('Dining')
    rerender(<AtRiskWidget ctx={makeCtx(api)} size="md" />)
    rerender(<AtRiskWidget ctx={makeCtx(api)} size="md" />)

    expect(api.get).toHaveBeenCalledTimes(1)
  })

  it('lets a slow response for an earlier zone lose to the newer one', async () => {
    const first = deferred<AtRiskResponse>()
    const second = deferred<AtRiskResponse>()
    const api = makeApi()
    api.get.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    const { rerender } = render(<AtRiskWidget ctx={makeCtx(api, 'UTC')} size="md" />)
    rerender(<AtRiskWidget ctx={makeCtx(api, 'Asia/Tokyo')} size="md" />)
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2))

    await act(async () => {
      second.resolve(atRisk({ lines: [{ ...overLine, categoryName: 'Newer' }] }))
    })
    await screen.findByText('Newer')
    await act(async () => {
      first.resolve(atRisk({ lines: [{ ...overLine, categoryName: 'Older' }] }))
    })

    expect(screen.getByText('Newer')).toBeTruthy()
    expect(screen.queryByText('Older')).toBeNull()
  })

  it('aborts its request when it is removed', async () => {
    const api = makeApi()
    api.get.mockReturnValue(deferred<AtRiskResponse>().promise)

    const { unmount } = render(<AtRiskWidget ctx={makeCtx(api)} size="md" />)
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1))
    const init = api.get.mock.calls[0]?.[1] as RequestInit

    unmount()

    expect(init.signal?.aborted).toBe(true)
  })

  it('shows an account allowance as a tile, and does not claim its spending in the month\'s total', async () => {
    const allowance = {
      ...overLine, id: 'al1', categoryId: 'account:a1', categoryName: 'Joint Checking spending',
      available: '190.0000', planned: '150.0000', spent: '60.0000', remaining: '130.0000',
      used: 60 / 190, pace: 1, health: 'on-track',
    } as MonthLine
    const api = makeApi()
    api.get.mockResolvedValue(atRisk({
      lines: [], total: 1, breakdown: [allowance], summary: { spent: '0.0000', available: '0.0000' },
    }))

    render(<AtRiskWidget ctx={makeCtx(api)} size="md" />)

    expect(await screen.findByText('Joint Checking spending')).toBeTruthy()
    expect(screen.getByText('$130.0000 left')).toBeTruthy()
    expect(screen.getByText(/of \$190\.0000/)).toBeTruthy()
    // Only account lines this month, so there is no category total to quote.
    expect(screen.queryByText(/of \$0\.0000 spent/)).toBeNull()
  })
})
