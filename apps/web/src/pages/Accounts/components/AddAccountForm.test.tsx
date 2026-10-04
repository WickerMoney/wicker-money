import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../../api/client.js'
import { errorOf } from '../../../testing/errorOf.js'
import { makeStatus } from '../../../testing/makeStatus.js'
import { validationFailed } from '../../../testing/validationFailed.js'
import { AddAccountForm } from './AddAccountForm.js'

function mount() {
  const onCreated = vi.fn(async () => {})
  render(<AddAccountForm status={makeStatus()} onCreated={onCreated} />)
  return { onCreated, user: userEvent.setup() }
}

afterEach(() => { vi.restoreAllMocks() })

describe('AddAccountForm', () => {
  it('refuses an opening balance with a fifth decimal place, under that field', async () => {
    const post = vi.spyOn(api, 'post')
    const { user } = mount()

    await user.type(screen.getByLabelText('Name'), 'Checking')
    await user.clear(screen.getByLabelText('Opening balance'))
    await user.type(screen.getByLabelText('Opening balance'), '10.12345')
    await user.click(screen.getByRole('button', { name: 'Add account' }))

    expect(errorOf('Opening balance')).toBe('Enter an amount like 12.50, with no more than 4 decimal places.')
    expect(document.activeElement).toBe(screen.getByLabelText('Opening balance'))
    expect(post).not.toHaveBeenCalled()
  })

  it("puts the server's issue on the field it names", async () => {
    vi.spyOn(api, 'post').mockRejectedValue(validationFailed([['name'], 'Must be 200 characters or fewer.']))
    const { user, onCreated } = mount()

    await user.type(screen.getByLabelText('Name'), 'Checking')
    await user.click(screen.getByRole('button', { name: 'Add account' }))

    await waitFor(() => { expect(errorOf('Name')).toBe('Must be 200 characters or fewer.') })
    expect(onCreated).not.toHaveBeenCalled()
  })
})
