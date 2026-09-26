import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../../api/client.js'
import { makeAccount } from '../../../testing/makeAccount.js'
import { makeCategory } from '../../../testing/makeCategory.js'
import { makeStatus } from '../../../testing/makeStatus.js'
import { TransactionEntryForm } from './TransactionEntryForm.js'

const accounts = [
  makeAccount({ id: 'acc-1', name: 'Checking' }),
  makeAccount({ id: 'acc-2', name: 'Savings' }),
]
const categories = [makeCategory({ id: 'cat-1', name: 'Groceries' })]

function mount(overrides: { accounts?: typeof accounts } = {}) {
  const status = makeStatus()
  const onRecorded = vi.fn(async () => {})
  render(
    <TransactionEntryForm
      accounts={overrides.accounts ?? accounts}
      enabledCategories={categories}
      status={status}
      onRecorded={onRecorded}
    />,
  )
  return { status, onRecorded, user: userEvent.setup() }
}

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

describe('with no accounts', () => {
  it('asks for an account first instead of showing a form', () => {
    mount({ accounts: [] })

    expect(screen.getByText('Add an account first')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Record' })).toBeNull()
  })
})

describe('recording spending or income', () => {
  it('starts on the spend form with the first account and a minus sign ready', () => {
    mount()

    expect(screen.getByRole('button', { name: 'Spending or income' }).getAttribute('aria-pressed')).toBe('true')
    expect((screen.getByLabelText('Account') as HTMLSelectElement).value).toBe('acc-1')
    expect((screen.getByLabelText('Amount') as HTMLInputElement).value).toBe('-')
  })

  it('keeps Record disabled until there is a merchant', async () => {
    const { user } = mount()
    const record = screen.getByRole('button', { name: 'Record' }) as HTMLButtonElement
    expect(record.disabled).toBe(true)

    await user.type(screen.getByLabelText('Merchant'), 'Cafe')

    expect(record.disabled).toBe(false)
  })

  it('posts the transaction, refreshes the list and clears the merchant and amount', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({})
    const { user, onRecorded, status } = mount()

    await user.type(screen.getByLabelText('Merchant'), 'Cafe')
    await user.clear(screen.getByLabelText('Amount'))
    await user.type(screen.getByLabelText('Amount'), '-4.50')
    await user.selectOptions(screen.getByLabelText('Account'), 'acc-2')
    await user.selectOptions(screen.getByLabelText('Category'), 'cat-1')
    await user.click(screen.getByRole('button', { name: 'Record' }))

    await waitFor(() => { expect(onRecorded).toHaveBeenCalledTimes(1) })
    expect(post).toHaveBeenCalledWith('/transactions', {
      accountId: 'acc-2', merchant: 'Cafe', amount: '-4.50',
      transactionDate: (screen.getByLabelText('Date') as HTMLInputElement).value,
      categoryId: 'cat-1',
    })
    expect((screen.getByLabelText('Merchant') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('Amount') as HTMLInputElement).value).toBe('-')
    expect(status.begin).toHaveBeenCalled()
    expect(status.end).toHaveBeenCalled()
  })

  it('leaves the category out so the rules can choose it', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({})
    const { user } = mount()

    await user.type(screen.getByLabelText('Merchant'), 'Cafe')
    await user.click(screen.getByRole('button', { name: 'Record' }))

    await waitFor(() => { expect(post).toHaveBeenCalled() })
    expect(post.mock.calls[0]![1]).not.toHaveProperty('categoryId')
  })

  it('defaults the date to today in the local time zone', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 0, 5, 23, 30))

    mount()

    expect((screen.getByLabelText('Date') as HTMLInputElement).value).toBe('2026-01-05')
  })

  it('shows the server message and keeps what was typed when recording fails', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(new Error('Amount is invalid'))
    const { user, status, onRecorded } = mount()

    await user.type(screen.getByLabelText('Merchant'), 'Cafe')
    await user.click(screen.getByRole('button', { name: 'Record' }))

    await waitFor(() => { expect(status.show).toHaveBeenCalledWith('Amount is invalid') })
    expect(onRecorded).not.toHaveBeenCalled()
    expect(status.end).toHaveBeenCalled()
    expect((screen.getByLabelText('Merchant') as HTMLInputElement).value).toBe('Cafe')
  })
})

describe('moving money between accounts', () => {
  async function toTransfer() {
    const ctx = mount()
    await ctx.user.click(screen.getByRole('button', { name: 'Transfer' }))
    return ctx
  }

  it('switches to the transfer form', async () => {
    await toTransfer()

    expect(screen.getByRole('button', { name: 'Move money' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Transfer' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByLabelText('From account')).toBeTruthy()
    expect(screen.getByLabelText('To account')).toBeTruthy()
    expect(screen.queryByLabelText('Merchant')).toBeNull()
  })

  it('offers every account except the source as the destination', async () => {
    await toTransfer()

    const options = Array.from((screen.getByLabelText('To account') as HTMLSelectElement).options).map((o) => o.value)
    expect(options).toEqual(['', 'acc-2'])
  })

  it('needs a destination and an amount before it can submit', async () => {
    const { user } = await toTransfer()
    const submit = screen.getByRole('button', { name: 'Move money' }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)

    await user.selectOptions(screen.getByLabelText('To account'), 'acc-2')
    expect(submit.disabled).toBe(true)
    await user.type(screen.getByLabelText('Amount'), '250.00')

    expect(submit.disabled).toBe(false)
  })

  it('posts both accounts, the amount and the optional description', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({})
    const { user, onRecorded } = await toTransfer()

    await user.selectOptions(screen.getByLabelText('To account'), 'acc-2')
    await user.type(screen.getByLabelText('Amount'), '250.00')
    await user.type(screen.getByLabelText('Description'), '  Monthly savings ')
    await user.click(screen.getByRole('button', { name: 'Move money' }))

    await waitFor(() => { expect(onRecorded).toHaveBeenCalledTimes(1) })
    expect(post).toHaveBeenCalledWith('/transactions/transfer', {
      fromAccountId: 'acc-1', toAccountId: 'acc-2', amount: '250.00',
      transactionDate: (screen.getByLabelText('Date') as HTMLInputElement).value,
      description: 'Monthly savings',
    })
    expect((screen.getByLabelText('Amount') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('Description') as HTMLInputElement).value).toBe('')
  })

  it('omits a blank description', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({})
    const { user } = await toTransfer()

    await user.selectOptions(screen.getByLabelText('To account'), 'acc-2')
    await user.type(screen.getByLabelText('Amount'), '10')
    await user.click(screen.getByRole('button', { name: 'Move money' }))

    await waitFor(() => { expect(post).toHaveBeenCalled() })
    expect(post.mock.calls[0]![1]).not.toHaveProperty('description')
  })

  it('shows the transfer-specific fallback message for a non-Error failure', async () => {
    vi.spyOn(api, 'post').mockRejectedValue('boom')
    const { user, status } = await toTransfer()

    await user.selectOptions(screen.getByLabelText('To account'), 'acc-2')
    await user.type(screen.getByLabelText('Amount'), '10')
    await user.click(screen.getByRole('button', { name: 'Move money' }))

    await waitFor(() => { expect(status.show).toHaveBeenCalledWith('Could not record the transfer.') })
  })

  it('keeps the shared fields when switching between the two forms', async () => {
    const { user } = mount()
    await user.type(screen.getByLabelText('Merchant'), 'Rent share')
    await user.selectOptions(screen.getByLabelText('Account'), 'acc-2')

    await user.click(screen.getByRole('button', { name: 'Transfer' }))

    expect((screen.getByLabelText('From account') as HTMLSelectElement).value).toBe('acc-2')
    expect((screen.getByLabelText('Description') as HTMLInputElement).value).toBe('Rent share')
  })
})
