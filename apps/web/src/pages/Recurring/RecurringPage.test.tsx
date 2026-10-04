import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../api/client.js'
import { formatDate } from '../../lib/formatDate.js'
import type {
  MatchSuggestionList, OccurrenceCandidates, RecurringItem, RecurringItemList, RecurringOccurrence,
} from '../../models/index.js'
import { makeAccount } from '../../testing/makeAccount.js'
import { errorOf } from '../../testing/errorOf.js'
import { makeCategory } from '../../testing/makeCategory.js'
import { validationFailed } from '../../testing/validationFailed.js'
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
    amount: '-2100.0000', monthlyEquivalent: '-2100.0000', nextDue: '2026-09-30', tracked: false, late: [], ...over,
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

/** An occurrence of the mortgage. */
function occurrence(over: Partial<RecurringOccurrence>): RecurringOccurrence {
  return {
    itemId: 'mortgage', date: '2026-09-30', nominalDate: '2026-09-30', expectedDate: '2026-09-30', status: 'upcoming',
    moved: false, changed: false, name: 'Mortgage', kind: 'bill', categoryId: 'rent', amount: '-2100.0000',
    legs: [{ accountId: 'chk', amount: '-2100.0000', transaction: null }], ...over,
  }
}

const history: readonly RecurringOccurrence[] = [
  occurrence({
    date: '2026-08-31', nominalDate: '2026-08-31', expectedDate: '2026-08-31', status: 'cleared',
    legs: [{ accountId: 'chk', amount: '-2100.0000', transaction: { id: 't-aug', date: '2026-08-31', amount: '-2100.0000', merchant: 'BANK MORTGAGE' } }],
  }),
  occurrence({}),
]

const candidates: OccurrenceCandidates = {
  today: '2026-09-28',
  occurrence: occurrence({}),
  legs: [{
    accountId: 'chk', amount: '-2100.0000',
    candidates: [{ transactionId: 't-sep', date: '2026-09-27', amount: '-2100.0000', merchant: 'BANK MORTGAGE', dayDifference: -3, amountDifference: '0.0000', confident: true }],
  }],
}

/** The occurrences the History panel asks for. */
function occurrencesFor(path: string): readonly RecurringOccurrence[] {
  return path.includes('itemId=mortgage') ? history : []
}

function serve(
  list: RecurringItemList,
  suggestions: MatchSuggestionList['suggestions'] = [],
  dismissed: MatchSuggestionList['dismissed'] = [],
) {
  return vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path.startsWith('/recurring-items/suggestions')) return { today: list.today, suggestions, dismissed }
    if (path.startsWith('/recurring-items/occurrences')) return { today: list.today, from: '', to: '', occurrences: occurrencesFor(path) }
    if (path.includes('/candidates')) return candidates
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
    expect(within(mortgageRow).getByText(formatDate('2026-09-30'))).toBeTruthy()
    expect(within(mortgageRow).queryByText(formatDate('2025-01-31'))).toBeNull()

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
      .toEqual(['2026-09-30', '2026-10-31', '2026-11-30'].map(formatDate))
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

describe('errors on the add/edit form', () => {
  it('refuses a zero bill under Amount and a missing name under Name, without sending', async () => {
    serve(full)
    const post = vi.spyOn(api, 'post')
    const user = userEvent.setup()
    render(<RecurringPage />)
    await screen.findByRole('button', { name: 'Add item' })

    await user.type(screen.getByLabelText('Amount'), '0')
    await user.click(screen.getByRole('button', { name: 'Add item' }))

    expect(errorOf('Name')).toBe('This cannot be empty.')
    expect(errorOf('Amount')).toBe('Must be more than 0.')
    expect(document.activeElement).toBe(screen.getByLabelText('Name'))
    expect(post).not.toHaveBeenCalled()
  })

  it("puts the API's refusal of a leg on the field it was typed in", async () => {
    serve(full)
    vi.spyOn(api, 'post').mockRejectedValue(
      validationFailed([['legs', 0, 'accountId'], 'That account is archived; restore it or pick another.']),
    )
    const user = userEvent.setup()
    render(<RecurringPage />)
    await screen.findByRole('button', { name: 'Add item' })

    await user.type(screen.getByLabelText('Name'), 'Phones')
    await user.type(screen.getByLabelText('Amount'), '85')
    await user.click(screen.getByRole('button', { name: 'Add item' }))

    await waitFor(() => { expect(errorOf('Paid from')).toBe('That account is archived; restore it or pick another.') })
  })
})

describe('paid / landed matching', () => {
  async function changeMortgage() {
    const user = userEvent.setup()
    render(<RecurringPage />)
    const row = (await screen.findByText('Mortgage')).closest('tr') as HTMLElement
    await user.click(within(row).getByRole('button', { name: 'History' }))
    await screen.findByText('Upcoming')
    await user.click(screen.getByRole('button', { name: 'Change' }))
    return user
  }

  it('refuses a zero amount on one occurrence under its field, pointing at Skip', async () => {
    serve(full)
    const put = vi.spyOn(api, 'put')
    const user = await changeMortgage()
    const amount = screen.getByLabelText('Amount, Monthly Expenses')

    await user.clear(amount)
    await user.type(amount, '0')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(errorOf('Amount, Monthly Expenses')).toBe('Must be more than 0. To leave this one out, skip it instead.')
    expect(put).not.toHaveBeenCalled()
  })

  it("puts the API's refusal of a move on Expected on", async () => {
    serve(full)
    vi.spyOn(api, 'put').mockRejectedValue(
      validationFailed([['expectedDate'], 'An occurrence can move at most 31 days from 2026-09-30.']),
    )
    const user = await changeMortgage()

    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(errorOf('Expected on')).toBe('An occurrence can move at most 31 days from 2026-09-30.')
    })
  })

  it('offers suggested matches and records one only when asked', async () => {
    serve(full, [{ occurrence: occurrence({}), accountId: 'chk', candidate: candidates.legs[0]!.candidates[0]! }])
    const post = vi.spyOn(api, 'post').mockResolvedValue(occurrence({ status: 'cleared' }))
    const user = userEvent.setup()
    render(<RecurringPage />)
    const panel = (await screen.findByText('Did these land?')).closest('section') ?? document.body
    expect(within(panel as HTMLElement).getByText(/BANK MORTGAGE/).textContent).toContain('3 days early')
    expect(post).not.toHaveBeenCalled()

    await user.click(within(panel as HTMLElement).getByRole('button', { name: 'Match' }))
    await waitFor(() => expect(post).toHaveBeenCalledWith(
      '/recurring-items/mortgage/occurrences/2026-09-30/matches', { transactionId: 't-sep' },
    ))
  })

  it('dismisses a suggestion so it is not offered again, and undoes a dismissal', async () => {
    serve(
      full,
      [{ occurrence: occurrence({}), accountId: 'chk', candidate: candidates.legs[0]!.candidates[0]! }],
      [{ occurrence: occurrence({ itemId: 'vac', name: 'Vacation Fund' }), accountId: 'chk',
        transaction: { id: 't-shop', date: '2026-09-29', amount: '-205.0000', merchant: 'Hardware Store' } }],
    )
    const post = vi.spyOn(api, 'post').mockResolvedValue({})
    const del = vi.spyOn(api, 'del').mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<RecurringPage />)
    const panel = (await screen.findByText('Did these land?')).closest('section') as HTMLElement

    await user.click(within(panel).getByRole('button', { name: 'Not Mortgage: BANK MORTGAGE' }))
    await waitFor(() => expect(post).toHaveBeenCalledWith(
      '/recurring-items/mortgage/occurrences/2026-09-30/dismissals', { transactionId: 't-sep' },
    ))

    expect(within(panel).getByText(/is not Vacation Fund/)).toBeTruthy()
    await user.click(within(panel).getByRole('button', { name: 'Undo: Hardware Store is not Vacation Fund' }))
    await waitFor(() => expect(del).toHaveBeenCalledWith('/recurring-items/vac/occurrences/2026-09-30/dismissals/t-shop'))
  })

  it('shows no suggestions panel when there is nothing to confirm', async () => {
    serve(full)
    render(<RecurringPage />)
    await screen.findByText('Vacation Fund')
    expect(screen.queryByText('Did these land?')).toBeNull()
  })

  it('flags a late occurrence on the item', async () => {
    serve({ ...full, items: [item({ id: 'mortgage', tracked: true, late: ['2026-09-25'] })] })
    render(<RecurringPage />)
    expect(await screen.findByText(`Late: ${formatDate('2026-09-25')}`)).toBeTruthy()
  })

  it('shows an item\'s history, finds the payment and matches it', async () => {
    serve(full)
    const post = vi.spyOn(api, 'post').mockResolvedValue(occurrence({ status: 'cleared' }))
    const user = userEvent.setup()
    render(<RecurringPage />)
    const row = (await screen.findByText('Mortgage')).closest('tr') as HTMLElement
    await user.click(within(row).getByRole('button', { name: 'History' }))

    expect(await screen.findByText('Paid')).toBeTruthy()
    expect(screen.getByText(/BANK MORTGAGE/).textContent).toContain(formatDate('2026-08-31'))
    await user.click(screen.getByRole('button', { name: 'Find payment' }))
    expect((await screen.findByText(/3 days early/)).textContent).toBe('(3 days early)')
    await user.click(screen.getAllByRole('button', { name: 'Match' }).at(-1) as HTMLElement)
    await waitFor(() => expect(post).toHaveBeenCalledWith(
      '/recurring-items/mortgage/occurrences/2026-09-30/matches', { transactionId: 't-sep' },
    ))
  })

  it('skips one occurrence, and changes one with the amount typed positive and sent negative', async () => {
    serve(full)
    const put = vi.spyOn(api, 'put').mockResolvedValue(occurrence({}))
    const user = userEvent.setup()
    render(<RecurringPage />)
    const row = (await screen.findByText('Mortgage')).closest('tr') as HTMLElement
    await user.click(within(row).getByRole('button', { name: 'History' }))
    await screen.findByText('Upcoming')

    await user.click(screen.getByRole('button', { name: 'Skip' }))
    await waitFor(() => expect(put).toHaveBeenCalledWith('/recurring-items/mortgage/occurrences/2026-09-30', { skipped: true }))

    await user.click(screen.getByRole('button', { name: 'Change' }))
    const amount = screen.getByLabelText('Amount, Monthly Expenses')
    await user.clear(amount)
    await user.type(amount, '2150')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(put).toHaveBeenLastCalledWith('/recurring-items/mortgage/occurrences/2026-09-30', {
      expectedDate: null, legs: [{ accountId: 'chk', amount: '-2150' }],
    }))
  })
})
