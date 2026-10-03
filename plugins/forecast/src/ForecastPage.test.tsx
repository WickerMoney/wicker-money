import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { PluginContext } from '@wickermoney/plugin-sdk/runtime'
import ForecastPage from './ForecastPage.js'
import type { ForecastResponse } from './models/index.js'

const base: ForecastResponse = {
  today: '2026-10-02',
  horizon: '90d',
  window: { from: '2026-10-03', through: '2026-10-06' },
  accounts: [
    { accountId: 'm', name: 'Monthly Expenses', accountType: 'checking' },
    { accountId: 's', name: 'Sinking Funds', accountType: 'savings' },
  ],
  account: { accountId: 'm', name: 'Monthly Expenses', accountType: 'checking', balance: '400.0000', buffer: '200.0000', cash: true },
  days: [
    { date: '2026-10-03', balance: '400.0000', low: '400.0000' },
    { date: '2026-10-04', balance: '900.0000', low: '-100.0000' },
    { date: '2026-10-05', balance: '600.0000', low: '600.0000' },
    { date: '2026-10-06', balance: '600.0000', low: '600.0000' },
  ],
  stats: {
    start: '400.0000', end: '600.0000', lowest: { date: '2026-10-04', balance: '-100.0000' },
    daysBelowZero: 1, daysBelowBuffer: 1,
    firstBelowZero: { date: '2026-10-04', balance: '-100.0000' },
    firstBelowBuffer: { date: '2026-10-04', balance: '-100.0000' },
  },
  entries: [
    { itemId: 'pay', date: '2026-10-04', name: 'Paycheck', kind: 'income', amount: '1000.0000', legs: [{ accountId: 'm', amount: '1000.0000' }] },
    { itemId: 'rent', date: '2026-10-04', name: 'Rent', kind: 'bill', amount: '-500.0000', legs: [{ accountId: 'm', amount: '-500.0000' }] },
    {
      itemId: 'save', date: '2026-10-05', name: 'Vacation fund', kind: 'transfer', amount: '-300.0000',
      legs: [{ accountId: 'm', amount: '-300.0000' }, { accountId: 's', amount: '300.0000' }],
    },
  ],
  hasItems: true,
}

function ctxWith(answer: (path: string) => ForecastResponse | Error): PluginContext {
  return {
    session: { userId: 'u1', email: 'u@example.com', timezone: 'UTC' },
    api: {
      get: vi.fn(async (path: string) => {
        const a = answer(path)
        if (a instanceof Error) throw a
        return a as never
      }),
      post: vi.fn(), put: vi.fn(), del: vi.fn(),
    },
    navigate: vi.fn(),
    // Deliberately naive formatters: the page must pass strings through, not numbers.
    formatMoney: (v) => `$${v}`,
    formatDate: (v) => v,
  }
}

describe('ForecastPage', () => {
  it('asks the server for the default account over 90 days', async () => {
    const ctx = ctxWith(() => base)
    render(<ForecastPage ctx={ctx} />)
    await screen.findByText('Monthly Expenses, next 90 days')
    expect(ctx.api.get).toHaveBeenCalledWith('/core/recurring-items/forecast?horizon=90d', expect.anything())
  })

  it('names the first breach and the stat tiles from the server, untouched', async () => {
    render(<ForecastPage ctx={ctxWith(() => base)} />)
    expect(await screen.findByText('Monthly Expenses goes below zero on 2026-10-04, to $-100.0000.')).toBeTruthy()
    expect(screen.getByText('Days below zero').nextSibling?.textContent).toBe('1')
    expect(screen.getByText('Lowest, 2026-10-04').nextSibling?.textContent).toBe('$-100.0000')
    expect(screen.getByText('Days below $200.0000 buffer')).toBeTruthy()
  })

  it('says so when the account stays clear', async () => {
    const clear: ForecastResponse = {
      ...base,
      stats: { ...base.stats!, lowest: { date: '2026-10-02', balance: '400.0000' }, daysBelowZero: 0, daysBelowBuffer: 0, firstBelowZero: null, firstBelowBuffer: null },
    }
    render(<ForecastPage ctx={ctxWith(() => clear)} />)
    expect(await screen.findByText('Monthly Expenses stays above its $200.0000 buffer through 2026-10-06.')).toBeTruthy()
  })

  it('lists what moves the line, with transfers in a neutral colour and their direction', async () => {
    render(<ForecastPage ctx={ctxWith(() => base)} />)
    const transfer = (await screen.findByText('Vacation fund')).closest('tr')!
    expect(transfer.textContent).toContain('to Sinking Funds')
    expect(transfer.querySelector('.fc-neg, .fc-pos')).toBeNull()
    const rent = screen.getByText('Rent').closest('tr')!
    expect(rent.querySelector('.fc-neg')?.textContent).toBe('$-500.0000')
    // End-of-day balance only on the last entry of a day.
    expect(screen.getByText('Paycheck').closest('tr')!.lastElementChild?.textContent).toBe('')
    expect(rent.lastElementChild?.textContent).toBe('$900.0000')
  })

  it('refetches for another account and another horizon', async () => {
    const ctx = ctxWith(() => base)
    render(<ForecastPage ctx={ctx} />)
    await screen.findByText('Monthly Expenses, next 90 days')

    await userEvent.selectOptions(screen.getByLabelText('Account'), 's')
    await waitFor(() => {
      expect(ctx.api.get).toHaveBeenCalledWith('/core/recurring-items/forecast?horizon=90d&accountId=s', expect.anything())
    })
    await userEvent.click(screen.getByRole('button', { name: '6 months' }))
    await waitFor(() => {
      expect(ctx.api.get).toHaveBeenCalledWith('/core/recurring-items/forecast?horizon=6m&accountId=s', expect.anything())
    })
    expect(screen.getByRole('button', { name: '6 months' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('reads out a day from the keyboard, with its dip and what lands', async () => {
    const { container } = render(<ForecastPage ctx={ctxWith(() => base)} />)
    await screen.findByText('Monthly Expenses, next 90 days')
    const chart = container.querySelector('svg[role="img"]')!
    fireEvent.focus(chart)
    fireEvent.keyDown(chart, { key: 'ArrowRight' })
    fireEvent.keyDown(chart, { key: 'ArrowRight' })
    const tip = container.querySelector('.fc-tip')!
    expect(tip.textContent).toContain('2026-10-04')
    expect(tip.textContent).toContain('Dips to $-100.0000')
    expect(tip.textContent).toContain('Rent')
  })

  it('draws a step path, never a curve', async () => {
    const { container } = render(<ForecastPage ctx={ctxWith(() => base)} />)
    await screen.findByText('Monthly Expenses, next 90 days')
    const d = container.querySelector('.fc-chart__line')!.getAttribute('d')!
    expect(d).toMatch(/^M[\d.]+,[\d.]+(?:[HV][\d.-]+)+$/)
  })

  it('leaves overdraft and buffer out for a card', async () => {
    const card: ForecastResponse = {
      ...base,
      account: { accountId: 'c', name: 'Card', accountType: 'credit_card', balance: '-800.0000', buffer: '0.0000', cash: false },
      stats: { ...base.stats!, daysBelowZero: null, daysBelowBuffer: null, firstBelowZero: null, firstBelowBuffer: null },
    }
    render(<ForecastPage ctx={ctxWith(() => card)} />)
    await screen.findByText('Card, next 90 days')
    expect(screen.queryByText('Days below zero')).toBeNull()
    expect(screen.queryByRole('status', { name: /stays above/ })).toBeNull()
    expect(screen.queryByText(/goes below zero/)).toBeNull()
  })

  it('sends someone with no recurring items to the Recurring page', async () => {
    const ctx = ctxWith(() => ({ ...base, hasItems: false, entries: [] }))
    render(<ForecastPage ctx={ctx} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Add recurring items' }))
    expect(ctx.navigate).toHaveBeenCalledWith('/recurring')
  })

  it('sends someone with no accounts to the Accounts page', async () => {
    const ctx = ctxWith(() => ({ ...base, accounts: [], account: null, days: [], stats: null, entries: [], hasItems: false }))
    render(<ForecastPage ctx={ctx} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Add an account' }))
    expect(ctx.navigate).toHaveBeenCalledWith('/accounts')
  })

  it('shows the error and keeps the last chart when a refetch fails', async () => {
    let fail = false
    const ctx = ctxWith(() => (fail ? new Error('Something went wrong.') : base))
    render(<ForecastPage ctx={ctx} />)
    await screen.findByText('Monthly Expenses, next 90 days')
    fail = true
    await userEvent.click(screen.getByRole('button', { name: '30 days' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Something went wrong.')
    expect(screen.getByText('Monthly Expenses, next 90 days')).toBeTruthy()
  })

  it('keeps an arrived occurrence listed without an amount, and tags a late one', async () => {
    const data: ForecastResponse = {
      ...base,
      entries: [
        { ...base.entries[0]!, status: 'cleared', nominalDate: '2026-10-04', amount: '0.0000' },
        { ...base.entries[1]!, status: 'late', nominalDate: '2026-10-01' },
      ],
    }
    render(<ForecastPage ctx={ctxWith(() => data)} />)
    expect(await screen.findByText('Arrived')).toBeDefined()
    expect(screen.getByText('Late, due 2026-10-01')).toBeDefined()
    const paycheck = screen.getByText('Paycheck').closest('tr')
    expect(paycheck?.querySelector('.fc-num')?.textContent).toBe('—')
  })
})
