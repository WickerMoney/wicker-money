import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { PluginContext } from '@wickermoney/plugin-sdk/runtime'
import UpcomingWidget from './UpcomingWidget.js'
import { isZeroAmount } from './helpers/isZeroAmount.js'
import { magnitude } from './helpers/magnitude.js'
import type { UpcomingResponse } from './models/index.js'

const base: UpcomingResponse = {
  today: '2026-09-28',
  window: { from: '2026-09-29', through: '2026-10-02', payday: '2026-10-02' },
  safeToSpend: '4750.0000',
  accounts: [
    {
      accountId: 'm', name: 'Monthly Expenses', balance: '1300.0000', buffer: '100.0000',
      lowest: { date: '2026-10-01', balance: '-200.0000' }, headroom: '-300.0000', short: true,
    },
    {
      accountId: 'y', name: 'Yearly Expenses', balance: '5000.0000', buffer: '250.0000',
      lowest: { date: '2026-09-28', balance: '5000.0000' }, headroom: '4750.0000', short: false,
    },
  ],
  occurrences: [
    { itemId: 'rent', date: '2026-10-01', name: 'Mortgage', kind: 'bill', categoryId: null, amount: '-1500.0000', legs: [{ accountId: 'm', amount: '-1500.0000' }] },
    { itemId: 'save', date: '2026-10-01', name: 'Vacation Fund', kind: 'transfer', categoryId: null, amount: '200.0000', legs: [{ accountId: 'm', amount: '-200.0000' }, { accountId: 's', amount: '200.0000' }] },
    { itemId: 'pay', date: '2026-10-02', name: 'Alex Paycheck', kind: 'income', categoryId: null, amount: '2200.0000', legs: [{ accountId: 'm', amount: '1850.0000' }, { accountId: 'y', amount: '350.0000' }] },
  ],
  hasItems: true,
}

const accounts = { accounts: [{ id: 'm', name: 'Monthly Expenses', type: 'checking' }, { id: 's', name: 'Sinking Funds', type: 'savings' }] }

function ctxWith(data: UpcomingResponse | Error): PluginContext {
  return {
    session: { userId: 'u1', email: 'u@example.com', timezone: 'UTC' },
    api: {
      get: vi.fn(async (path: string) => {
        if (data instanceof Error) throw data
        return (path.includes('upcoming') ? data : accounts) as never
      }),
      post: vi.fn(), put: vi.fn(), del: vi.fn(),
    },
    navigate: vi.fn(),
    // Deliberately naive formatters: the widget must pass strings through, not numbers.
    formatMoney: (v) => `$${v}`,
    formatDate: (v) => v,
  }
}

describe('UpcomingWidget', () => {
  it('asks the server, and only the server, for the outlook', async () => {
    const ctx = ctxWith(base)
    render(<UpcomingWidget ctx={ctx} size="lg" />)
    await screen.findByText(/Safe to spend/)
    expect(ctx.api.get).toHaveBeenCalledWith('/core/recurring-items/upcoming', expect.anything())
    expect(ctx.api.get).toHaveBeenCalledWith('/core/accounts/list', expect.anything())
  })

  it('shows safe to spend until payday', async () => {
    const { container } = render(<UpcomingWidget ctx={ctxWith(base)} size="lg" />)
    expect(await screen.findByText('Safe to spend until payday, 2026-10-02')).toBeDefined()
    expect(container.querySelector('.upc-head__value')?.textContent).toBe('$4750.0000')
  })

  it('names a short account in words, never netting it against the other', async () => {
    render(<UpcomingWidget ctx={ctxWith(base)} size="lg" />)
    // Wait for the outlook: the loading spinner is a status too.
    await screen.findByText(/Safe to spend/)
    const status = screen.getByRole('status')
    expect(status.textContent).toContain(
      'Monthly Expenses drops to $-200.0000 on 2026-10-01, $300.0000 below its $100.0000 buffer.',
    )
    expect(status.textContent).toContain("not covered by another account's surplus")
  })

  it('lists bills and income, and transfers only when asked', async () => {
    const user = userEvent.setup()
    render(<UpcomingWidget ctx={ctxWith(base)} size="lg" />)
    await screen.findByText('Mortgage')
    expect(screen.getByText('Alex Paycheck')).toBeDefined()
    expect(screen.getByText('Monthly Expenses + Yearly Expenses')).toBeDefined()
    expect(screen.queryByText('Vacation Fund')).toBeNull()

    await user.click(screen.getByLabelText('Show transfers'))
    expect(screen.getByText('Vacation Fund')).toBeDefined()
    expect(screen.getByText('Monthly Expenses → Sinking Funds')).toBeDefined()
  })

  it('says so when no income is expected and it looks two weeks ahead', async () => {
    render(<UpcomingWidget ctx={ctxWith({ ...base, window: { from: '2026-09-29', through: '2026-10-12', payday: null } })} size="lg" />)
    expect(await screen.findByText('Safe to spend through 2026-10-12')).toBeDefined()
    expect(screen.getByText(/No income expected soon/)).toBeDefined()
  })

  it('shows no banner when every account makes it', async () => {
    const fine = { ...base, accounts: base.accounts.filter((a) => !a.short) }
    render(<UpcomingWidget ctx={ctxWith(fine)} size="lg" />)
    await screen.findByText(/Safe to spend/)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('names the accounts it counts, treating a server without the flag as counting all', async () => {
    render(<UpcomingWidget ctx={ctxWith(base)} size="lg" />)
    expect(await screen.findByText(/Counting Monthly Expenses, Yearly Expenses\./)).toBeDefined()
    expect(screen.queryByText('not counted')).toBeNull()
  })

  it('lists an account that is not counted, labelled, and links to where that is chosen', async () => {
    const accounts = [base.accounts[0]!, { ...base.accounts[1]!, counted: false }]
    const ctx = ctxWith({ ...base, accounts: [{ ...accounts[0]!, counted: true }, accounts[1]!] })
    const user = userEvent.setup()
    render(<UpcomingWidget ctx={ctx} size="lg" />)

    expect(await screen.findByText(/Counting Monthly Expenses\./)).toBeDefined()
    const row = screen.getByText('not counted').closest('tr') as HTMLElement
    expect(row.textContent).toContain('Yearly Expenses')
    expect(row.className).toContain('is-uncounted')

    await user.click(screen.getByRole('button', { name: 'Choose accounts' }))
    expect(ctx.navigate).toHaveBeenCalledWith('/accounts')
  })

  it('says so when no account counts', async () => {
    const none = { ...base, safeToSpend: '0.0000', accounts: base.accounts.map((a) => ({ ...a, counted: false })) }
    render(<UpcomingWidget ctx={ctxWith(none)} size="lg" />)
    expect(await screen.findByText(/No account counts toward safe to spend yet\./)).toBeDefined()
    expect(screen.getAllByText('not counted')).toHaveLength(2)
  })

  it('invites adding items when there are none', async () => {
    const ctx = ctxWith({ ...base, hasItems: false, occurrences: [], accounts: [] })
    const user = userEvent.setup()
    render(<UpcomingWidget ctx={ctx} size="lg" />)
    await user.click(await screen.findByRole('button', { name: 'Add recurring items' }))
    expect(ctx.navigate).toHaveBeenCalledWith('/recurring')
  })

  it('shows the error when the outlook cannot be loaded', async () => {
    render(<UpcomingWidget ctx={ctxWith(new Error('grant_denied'))} size="lg" />)
    await waitFor(() => expect(screen.getByText('grant_denied')).toBeDefined())
  })
})

describe('amount text helpers', () => {
  it('drops a sign without parsing', () => {
    expect(magnitude('-300.0000')).toBe('300.0000')
    expect(magnitude('12345678901234567.8901')).toBe('12345678901234567.8901')
  })

  it.each([['0', true], ['0.0000', true], ['-0.00', true], ['0.01', false], ['', false], ['.', false]])('isZeroAmount(%j) = %s', (v, zero) => {
    expect(isZeroAmount(v)).toBe(zero)
  })

  it('tags what already arrived and what is late, so the list says what is still to come', async () => {
    const data: UpcomingResponse = {
      ...base,
      occurrences: [
        { ...base.occurrences[0]!, status: 'late', nominalDate: '2026-09-25', expectedDate: '2026-09-25', date: '2026-09-29' },
        { ...base.occurrences[2]!, status: 'cleared', nominalDate: '2026-10-02', expectedDate: '2026-10-02' },
      ],
    }
    render(<UpcomingWidget ctx={ctxWith(data)} size="lg" />)
    expect(await screen.findByText('Late, due 2026-09-25')).toBeDefined()
    expect(screen.getByText('Arrived')).toBeDefined()
  })

  it('shows no tag for occurrences from a server older than matching', async () => {
    render(<UpcomingWidget ctx={ctxWith(base)} size="lg" />)
    await screen.findByText('Mortgage')
    expect(screen.queryByText('Arrived')).toBeNull()
  })
})
