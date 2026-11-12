import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { PluginPageProps } from '@wickermoney/plugin-sdk'
import BudgetsPage from './BudgetsPage.js'
import type { MonthLine, MonthResponse } from './models/index.js'
import { makeApi } from './testing/makeApi.js'
import { makeCtx } from './testing/makeCtx.js'

const groceries: MonthLine = {
  id: 'l1', categoryId: 'c-groc', categoryName: 'Groceries', planned: '400.0000', carriedIn: '0.0000',
  available: '400.0000', spent: '100.0000', remaining: '300.0000', rollover: false,
  used: 0.25, pace: 0.5, elapsed: 0.5, health: 'ahead', note: null, draft: false, window: null,
}

const month = (over: Partial<MonthResponse> = {}): MonthResponse => ({
  monthKey: '2026-06', period: { start: '2026-06-01', end: '2026-07-01' }, today: '2026-06-15', draft: false,
  lines: [groceries], unbudgeted: [],
  summary: {
    planned: '400.0000', available: '400.0000', spent: '100.0000', remaining: '300.0000',
    unbudgetedSpent: '0.0000', overCount: 0, atRiskCount: 0,
  },
  ...over,
})

beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-06-15T12:00:00Z') }) })
afterAll(() => { vi.useRealTimers() })

/** The heading of the section (the `Surface`) an element is in. */
const sectionOf = (el: HTMLElement): string => within(el.closest('section')!).getByRole('heading', { level: 2 }).textContent ?? ''

function renderPage(first: MonthResponse, later: MonthResponse = first) {
  const api = makeApi()
  let loads = 0
  api.get.mockImplementation((path: string) => {
    if (path.startsWith('/core/categories')) return Promise.resolve([])
    if (path.startsWith('/core/accounts')) return Promise.resolve({ accounts: [] })
    return Promise.resolve(loads++ === 0 ? first : later)
  })
  render(<BudgetsPage {...({ ctx: makeCtx(api) } as PluginPageProps)} />)
  return api
}

describe('where the page says what happened', () => {
  it('puts the result of starting the month in the month section, not above the page', async () => {
    const draftLine = { ...groceries, draft: true }
    const api = renderPage(month({ draft: true, lines: [draftLine] }), month())
    api.post.mockResolvedValue({ created: 1 })

    fireEvent.click(await screen.findByRole('button', { name: /Start June 2026 from these/ }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('1 lines carried over from May 2026.')
    expect(sectionOf(alert)).toBe('June 2026')
  })

  it('puts a failed removal in the Lines section, beside the row', async () => {
    const api = renderPage(month())
    api.del.mockRejectedValue(new Error('That line is gone.'))

    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('That line is gone.')
    expect(sectionOf(alert)).toBe('Lines')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove' })).toHaveProperty('disabled', false))
  })

  it('puts a load failure in the month section', async () => {
    const api = makeApi()
    api.get.mockImplementation((path: string) =>
      path.startsWith('/core/') ? Promise.resolve(path.includes('accounts') ? { accounts: [] } : []) : Promise.reject(new Error('boom')))
    render(<BudgetsPage {...({ ctx: makeCtx(api) } as PluginPageProps)} />)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('boom')
    expect(sectionOf(alert)).toBe('June 2026')
  })
})
