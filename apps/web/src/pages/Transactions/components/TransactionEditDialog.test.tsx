import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { NO_FORM_ERRORS, type FormErrors } from '@wickermoney/ui-kit'
import type { TransactionEdit } from '../state/TransactionEdit.js'
import type { TransactionEditing } from '../state/TransactionEditing.js'
import { TransactionEditDialog } from './TransactionEditDialog.js'

const base: TransactionEdit = {
  id: 't1', merchant: 'Safelite', amount: '-93.82', transactionDate: '2026-10-07', notes: '', isTransfer: false,
}

function mount(over: { editing?: TransactionEdit | null; errors?: FormErrors; busy?: boolean } = {}) {
  const row: TransactionEditing = {
    editing: over.editing === undefined ? base : over.editing,
    errors: over.errors ?? NO_FORM_ERRORS,
    change: vi.fn(), start: vi.fn(), cancel: vi.fn(),
    save: vi.fn(async () => {}), remove: vi.fn(async () => {}), assign: vi.fn(async () => {}),
  }
  render(<TransactionEditDialog row={row} busy={over.busy ?? false} />)
  return { row, user: userEvent.setup() }
}

describe('TransactionEditDialog', () => {
  it('renders nothing while no row is being edited', () => {
    mount({ editing: null })

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows the row being edited, with the merchant ready to type in', () => {
    mount()

    expect(screen.getByRole('dialog', { name: 'Edit transaction' })).toBeTruthy()
    expect((screen.getByLabelText(/Merchant/) as HTMLInputElement).value).toBe('Safelite')
    expect((screen.getByLabelText(/Amount/) as HTMLInputElement).value).toBe('-93.82')
    expect((screen.getByLabelText(/Date/) as HTMLInputElement).value).toBe('2026-10-07')
    expect(document.activeElement).toBe(screen.getByLabelText(/Merchant/))
  })

  it('reports each change with the other fields kept', async () => {
    const { row, user } = mount()

    await user.type(screen.getByLabelText('Notes'), 'x')

    expect(row.change).toHaveBeenCalledWith({ ...base, notes: 'x' })
  })

  it('saves on Enter and from the Save button, and cancels from Cancel', async () => {
    const { row, user } = mount()

    await user.type(screen.getByLabelText('Notes'), '{Enter}')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(row.save).toHaveBeenCalledTimes(2)
    expect(row.cancel).toHaveBeenCalledTimes(1)
  })

  it('will not save without a merchant or an amount', () => {
    mount({ editing: { ...base, merchant: ' ' } })

    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('marks Save and Cancel busy, still focusable and ignoring clicks, while a request is running', async () => {
    const { row } = mount({ busy: true })
    const saving = screen.getByRole('button', { name: 'Saving…' }) as HTMLButtonElement
    const cancel = screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement

    // Busy, not `disabled`: a disabled control would drop keyboard focus to <body>.
    for (const b of [saving, cancel]) { expect(b.getAttribute('aria-disabled')).toBe('true'); expect(b.disabled).toBe(false) }
    cancel.focus()
    expect(document.activeElement).toBe(cancel)
    await userEvent.click(cancel)
    await userEvent.click(saving)
    expect(row.cancel).not.toHaveBeenCalled()
    expect(row.save).not.toHaveBeenCalled()
  })

  it('shows field errors under their fields and a form error beside Save', () => {
    mount({ errors: { form: 'Could not save that transaction.', fields: { amount: 'Enter an amount.' } } })

    expect(screen.getByText('Enter an amount.')).toBeTruthy()
    expect(screen.getByText('Could not save that transaction.')).toBeTruthy()
  })

  it('says a transfer leg updates the other side', () => {
    mount({ editing: { ...base, isTransfer: true } })

    expect(screen.getByText(/other side/)).toBeTruthy()
  })
})
