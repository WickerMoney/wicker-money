import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { NO_FORM_ERRORS } from '@wickermoney/ui-kit'
import type { AccountLine, AccountOption, Category } from '../models/index.js'
import { AccountLineForm } from './AccountLineForm.js'
import { AccountLinesTable } from './AccountLinesTable.js'

const money = (v: string) => `$${v}`

const ACCOUNTS: AccountOption[] = [
  { id: 'a-joint', name: 'Joint Checking', type: 'checking' },
  { id: 'a-bills', name: 'Bills Checking', type: 'checking' },
]
const CATEGORIES: Category[] = [
  { id: 'c-gifts', name: 'Holiday Gifts', parent_id: null },
  { id: 'c-groc', name: 'Groceries', parent_id: null },
]

const allowance: AccountLine = {
  id: 'al1', accountId: 'a-joint', accountName: 'Joint Checking', categoryId: 'account:a-joint',
  categoryName: 'Joint Checking spending', planned: '150.0000', carriedIn: '40.0000', available: '190.0000',
  spent: '60.0000', remaining: '130.0000', rollover: true, used: 60 / 190, pace: 1, elapsed: 0.3,
  health: 'on-track', excludedCategoryIds: ['c-gifts'], note: null, draft: false,
}

describe('AccountLinesTable', () => {
  function renderTable(lines: AccountLine[], handlers = { onEdit: vi.fn(), onRemove: vi.fn() }) {
    render(
      <AccountLinesTable
        lines={lines} monthKey="2026-10" today="2026-10-09" busy={false}
        categoryName={(id) => CATEGORIES.find((c) => c.id === id)?.name ?? 'unknown'}
        formatMoney={money} {...handlers}
      />,
    )
    return handlers
  }

  it('shows what is left, what carried in, and what is not counted', () => {
    renderTable([allowance])
    expect(screen.getByText('Joint Checking')).toBeTruthy()
    expect(screen.getByText('$130.0000')).toBeTruthy()
    expect(screen.getByText(/carried in \$40\.0000/)).toBeTruthy()
    expect(screen.getByText(/not counting Holiday Gifts/)).toBeTruthy()
  })

  it('calls an overdrawn carry-in overdrawn', () => {
    renderTable([{ ...allowance, carriedIn: '-20.0000' }])
    expect(screen.getByText(/overdrawn \$-20\.0000/)).toBeTruthy()
  })

  it('edits and removes a saved allowance', () => {
    const { onEdit, onRemove } = renderTable([allowance])
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(onEdit).toHaveBeenCalledWith(allowance)
    expect(onRemove).toHaveBeenCalledWith(allowance)
  })

  it('offers no Remove for a draft, which has nothing stored', () => {
    renderTable([{ ...allowance, id: null, draft: true }])
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
  })
})

describe('AccountLineForm', () => {
  function renderForm(editing: AccountLine | null = null, onSave = vi.fn().mockResolvedValue(NO_FORM_ERRORS)) {
    const onCancel = vi.fn()
    render(
      <AccountLineForm
        accounts={ACCOUNTS} categories={CATEGORIES} editing={editing} busy={false}
        onSave={onSave} onCancel={onCancel}
      />,
    )
    return { onSave, onCancel }
  }

  it('says why there is nothing to add when the user has no checking account', () => {
    render(
      <AccountLineForm accounts={[]} categories={CATEGORIES} editing={null} busy={false}
                       onSave={vi.fn()} onCancel={vi.fn()} />,
    )
    expect(screen.getByText(/no checking account|none to choose from/i)).toBeTruthy()
  })

  it('needs an amount before it can be added', () => {
    renderForm()
    expect((screen.getByRole('button', { name: 'Add allowance' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Allowance'), { target: { value: '150' } })
    expect((screen.getByRole('button', { name: 'Add allowance' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('submits the account, amount, rollover and the categories left out', async () => {
    const { onSave } = renderForm()
    fireEvent.change(screen.getByLabelText('Allowance'), { target: { value: '150.00' } })
    fireEvent.change(screen.getByLabelText("Don't count"), { target: { value: 'c-gifts' } })
    fireEvent.click(screen.getByLabelText(/Carry what is left/))
    fireEvent.click(screen.getByRole('button', { name: 'Add allowance' }))

    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onSave).toHaveBeenCalledWith({
      accountId: 'a-joint', planned: '150.00', rollover: false, excludedCategoryIds: ['c-gifts'], note: null,
    })
  })

  it('lets a left-out category be counted again, and offers it back', () => {
    renderForm()
    fireEvent.change(screen.getByLabelText("Don't count"), { target: { value: 'c-gifts' } })
    expect(screen.getByRole('list', { name: 'Categories not counted' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Count Holiday Gifts again' }))
    expect(screen.queryByRole('list', { name: 'Categories not counted' })).toBeNull()
  })

  it('clears itself after a save, and shows the server\'s problem when there is one', async () => {
    const onSave = vi.fn().mockResolvedValue({ fields: { planned: 'Must be zero or more.' }, form: null })
    renderForm(null, onSave)
    fireEvent.change(screen.getByLabelText('Allowance'), { target: { value: '-5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add allowance' }))
    expect(await screen.findByText('Must be zero or more.')).toBeTruthy()
    expect((screen.getByLabelText('Allowance') as HTMLInputElement).value).toBe('-5')
  })

  it('edits an allowance in place: account locked, fields filled, Cancel leaves', () => {
    const { onCancel } = renderForm(allowance)
    expect(screen.getByText('Edit the Joint Checking allowance')).toBeTruthy()
    expect((screen.getByLabelText('Account') as HTMLSelectElement).disabled).toBe(true)
    expect((screen.getByLabelText('Allowance') as HTMLInputElement).value).toBe('150.00')
    expect(screen.getByRole('button', { name: 'Count Holiday Gifts again' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
  })
})
