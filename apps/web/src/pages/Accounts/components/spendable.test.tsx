import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../../api/client.js'
import { makeAccount } from '../../../testing/makeAccount.js'
import { makeStatus } from '../../../testing/makeStatus.js'
import { AccountsPanel } from './AccountsPanel.js'
import { AddAccountForm } from './AddAccountForm.js'

afterEach(() => { vi.restoreAllMocks() })

function panel(accounts = [makeAccount()]) {
  const onChanged = vi.fn(async () => {})
  render(
    <AccountsPanel
      accounts={accounts} includeArchived={false} onIncludeArchivedChange={vi.fn()}
      status={makeStatus()} onChanged={onChanged}
      onFixOpeningBalance={vi.fn()} onArchive={vi.fn()} onDelete={vi.fn()}
    />,
  )
  return { onChanged }
}

describe('the "Safe to spend" column', () => {
  it('saves the choice as soon as the box changes, then re-reads the list', async () => {
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({})
    const { onChanged } = panel([makeAccount({ id: 'y', name: 'Yearly Expenses', spendable: true })])

    await userEvent.setup().click(screen.getByLabelText('Count Yearly Expenses toward safe to spend'))

    expect(patch).toHaveBeenCalledWith('/accounts/y', { spendable: false })
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('offers no box for a card or loan', () => {
    panel([makeAccount({ name: 'Card', accountType: 'credit_card', spendable: false })])
    expect(screen.queryByLabelText('Count Card toward safe to spend')).toBeNull()
    expect(screen.getByTitle(/Only checking and savings/)).toBeDefined()
  })
})

describe('the "Buffer" column', () => {
  it('shows the buffer, edits it with the row, and sends a cleared field as zero', async () => {
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({})
    const user = userEvent.setup()
    panel([makeAccount({ id: 'm', name: 'Monthly', bufferAmount: '500.00' })])
    expect(screen.getByText('$500.00')).toBeDefined()

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    const input = screen.getByLabelText('Buffer for Monthly')
    await user.clear(input)
    await user.type(input, '750')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(patch).toHaveBeenLastCalledWith('/accounts/m', expect.objectContaining({ bufferAmount: '750' }))

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.clear(screen.getByLabelText('Buffer for Monthly'))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(patch).toHaveBeenLastCalledWith('/accounts/m', expect.objectContaining({ bufferAmount: '0' }))
  })

  it('has no buffer for a card, and drops the input when the type is changed to one', async () => {
    const user = userEvent.setup()
    panel([makeAccount({ id: 'm', name: 'Monthly' })])
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByLabelText('Buffer for Monthly')).toBeDefined()
    await user.selectOptions(screen.getByLabelText('Type of Monthly'), 'credit_card')
    expect(screen.queryByLabelText('Buffer for Monthly')).toBeNull()
  })
})

describe('adding an account', () => {
  it('counts checking by default, not savings, and offers nothing for a card', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({})
    const user = userEvent.setup()
    render(<AddAccountForm status={makeStatus()} onCreated={vi.fn(async () => {})} />)
    const box = () => screen.queryByLabelText('Count toward safe to spend') as HTMLInputElement | null

    expect(box()?.checked).toBe(true)
    await user.selectOptions(screen.getByLabelText('Type'), 'savings')
    expect(box()?.checked).toBe(false)
    await user.selectOptions(screen.getByLabelText('Type'), 'credit_card')
    expect(box()).toBeNull()

    await user.selectOptions(screen.getByLabelText('Type'), 'savings')
    await user.click(box()!)
    await user.type(screen.getByLabelText(/Name/), 'High Yield')
    await user.click(screen.getByRole('button', { name: 'Add account' }))

    expect(post).toHaveBeenCalledWith('/accounts', expect.objectContaining({ accountType: 'savings', spendable: true }))
  })
})
