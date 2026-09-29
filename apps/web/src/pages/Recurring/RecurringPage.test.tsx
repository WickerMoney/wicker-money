import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../api/client.js'
import type { RecurringItem, RecurringItemList } from '../../models/index.js'
import { makeAccount } from '../../testing/makeAccount.js'
import { makeCategory } from '../../testing/makeCategory.js'
import { RecurringPage } from './RecurringPage.js'

const accounts = [
  makeAccount({ id: 'chk', name: 'Monthly Expenses' }),
  makeAccount({ id: 'sav', name: 'Sinking Funds', accountType: 'savings' }),
  makeAccount({ id: 'card', name: 'Everyday Card', accountType: 'credit_card' }),
]
const categories = [
  makeCategory({ id: 'rent', name: 'Mortgage / rent', kind: 'expense' }),
  makeCategory({ id: 'salary', name: 'Salary', kind: 'income' }),
]

function item(over: Partial<RecurringItem>): RecurringItem {
  return {
    id: 'i', name: 'Mortgage', kind: 'bill', frequency: 'monthly', seriesStartDate: '2025-01-31', endDate: null,
    semimonthlyDays: null, categoryId: 'rent', legs: [{ accountId: 'chk', amount: '-2100.0000' }],
    amount: '-2100.0000', monthlyEquivalent: '-2100.0000', nextDue: '2026-09-30', ...over,
  }
}

const full: RecurringItemList = {
  today: '2026-09-28',
  items: [
    item({ id: 'mortgage' }),
    item({
      id: 'pay', name: 'Alex Paycheck', kind: 'income', frequency: 'biweekly', categoryId: 'salary',
      legs: [{ accountId: 'chk', amount: '1850.0000' }, { accountId: 'sav', amount: '350.0000' }],
      amount: '2200.0000', monthlyEquivalent: '4766.6667', nextDue: '2026-10-02',
    }),
    item({
      id: 'vac', name: 'Vacation Fund', kind: 'transfer', categoryId: null,
      legs: [{ accountId: 'chk', amount: '-200.0000' }, { accountId: 'sav', amount: '200.0000' }],
      amount: '200.0000', monthlyEquivalent: '200.0000', nextDue: '2026-10-05',
    }),
  ],
  summary: { monthlyIncome: '4766.6667', monthlyOutgoings: '-2100.0000', monthlyNet: '2666.6667' },
}

function serve(list: RecurringItemList) {
  return vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path.startsWith('/recurring-items')) return list
    if (path.startsWith('/accounts')) return accounts
    if (path.startsWith('/categories')) return categories
    throw new Error(`unexpected ${path}`)
  })
}

afterEach(() => { vi.restoreAllMocks() })

describe('the list', () => {
  it('groups income, outgoings and transfers, showing the derived next due date, never the anchor', async () => {
    serve(full)
    render(<RecurringPage />)

    const income = await screen.findByRole('heading', { name: 'Income' })
    expect(income).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Bills and debt payments' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Transfers' })).toBeTruthy()

    const mortgageRow = screen.getByText('Mortgage').closest('tr') as HTMLElement
    expect(within(mortgageRow).getByText('2026-09-30')).toBeTruthy()
    expect(within(mortgageRow).queryByText('2025-01-31')).toBeNull()

    const splitRow = screen.getByText('Alex Paycheck').closest('tr') as HTMLElement
    expect(within(splitRow).getByText('Monthly Expenses + Sinking Funds')).toBeTruthy()

    const transferRow = screen.getByText('Vacation Fund').closest('tr') as HTMLElement
    expect(transferRow.textContent).toContain('Monthly Expenses → Sinking Funds')
  })

  it('shows the server\'s monthly tiles', async () => {
    serve(full)
    render(<RecurringPage />)
    expect(await screen.findByText('Left over')).toBeTruthy()
    expect(screen.getByText('Transfers between your own accounts are not counted.')).toBeTruthy()
  })

  it('shows an empty state with the form still available', async () => {
    serve({ ...full, items: [], summary: { monthlyIncome: '0.0000', monthlyOutgoings: '0.0000', monthlyNet: '0.0000' } })
    render(<RecurringPage />)
    expect(await screen.findByText('Nothing recurring yet')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add item' })).toBeTruthy()
  })
})

describe('the form', () => {
  it('adds a bill with the amount typed positive and sent negative', async () => {
    serve(full)
    const post = vi.spyOn(api, 'post').mockResolvedValue({})
    const user = userEvent.setup()
    render(<RecurringPage />)
    await screen.findByRole('button', { name: 'Add item' })

    await user.type(screen.getByLabelText('Name'), 'Phones')
    await user.type(screen.getByLabelText('Amount'), '85')
    await user.click(screen.getByRole('button', { name: 'Add item' }))

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
    expect(post).toHaveBeenCalledWith('/recurring-items', expect.objectContaining({
      name: 'Phones', kind: 'bill', frequency: 'monthly', seriesStartDate: '2026-09-28',
      legs: [{ accountId: 'chk', amount: '-85' }],
    }))
  })

  it('offers only categories of the matching kind, and none for a transfer', async () => {
    serve(full)
    const user = userEvent.setup()
    render(<RecurringPage />)
    await screen.findByRole('button', { name: 'Add item' })

    const options = () => Array.from((screen.getByLabelText('Category (optional)') as HTMLSelectElement).options).map((o) => o.text)
    expect(options()).toEqual(['None', 'Mortgage / rent'])
    await user.selectOptions(screen.getByLabelText('Kind'), 'income')
    expect(options()).toEqual(['None', 'Salary'])
    await user.selectOptions(screen.getByLabelText('Kind'), 'transfer')
    expect(screen.queryByLabelText('Category (optional)')).toBeNull()
  })

  it('only offers cards and loans as a debt payment\'s destination', async () => {
    serve(full)
    const user = userEvent.setup()
    render(<RecurringPage />)
    await screen.findByRole('button', { name: 'Add item' })
    await user.selectOptions(screen.getByLabelText('Kind'), 'debt_payment')
    const to = Array.from((screen.getByLabelText('Pays (card or loan)') as HTMLSelectElement).options).map((o) => o.text)
    expect(to).toEqual(['Choose an account', 'Everyday Card'])
  })

  it('previews the next dates from the server\'s today', async () => {
    serve(full)
    const user = userEvent.setup()
    render(<RecurringPage />)
    await screen.findByRole('button', { name: 'Add item' })
    const start = screen.getByLabelText('First date')
    await user.clear(start)
    await user.type(start, '2025-01-31')
    const preview = screen.getByText('Next dates').parentElement as HTMLElement
    expect(within(preview).getAllByRole('listitem').map((li) => li.textContent).slice(0, 3))
      .toEqual(['2026-09-30', '2026-10-31', '2026-11-30'])
  })

  it('edits an existing transfer with PUT and shows the API\'s message when it refuses', async () => {
    serve(full)
    const put = vi.spyOn(api, 'put').mockRejectedValue(new Error('legs: A transfer is two legs that cancel out.'))
    const user = userEvent.setup()
    render(<RecurringPage />)
    const row = (await screen.findByText('Vacation Fund')).closest('tr') as HTMLElement
    await user.click(within(row).getByRole('button', { name: 'Edit' }))

    expect((screen.getByLabelText('Amount') as HTMLInputElement).value).toBe('200.0000')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(put).toHaveBeenCalledWith('/recurring-items/vac', expect.objectContaining({
      kind: 'transfer', legs: [{ accountId: 'chk', amount: '-200.0000' }, { accountId: 'sav', amount: '200.0000' }],
    })))
    expect(await screen.findByText('legs: A transfer is two legs that cancel out.')).toBeTruthy()
  })
})
