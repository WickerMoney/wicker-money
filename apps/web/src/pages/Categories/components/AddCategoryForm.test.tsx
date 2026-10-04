import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../api/ApiError.js'
import { api } from '../../../api/client.js'
import { errorOf } from '../../../testing/errorOf.js'
import { makeStatus } from '../../../testing/makeStatus.js'
import { validationFailed } from '../../../testing/validationFailed.js'
import { AddCategoryForm } from './AddCategoryForm.js'

function mount() {
  const onChanged = vi.fn(async () => {})
  render(<AddCategoryForm parents={[]} status={makeStatus()} onChanged={onChanged} />)
  return { onChanged, user: userEvent.setup() }
}

afterEach(() => { vi.restoreAllMocks() })

describe('AddCategoryForm', () => {
  it('refuses a name longer than the API allows, under the name, without sending it', async () => {
    const post = vi.spyOn(api, 'post')
    const { user } = mount()

    await user.click(screen.getByLabelText('Name'))
    await user.paste('x'.repeat(101))
    await user.click(screen.getByRole('button', { name: 'Add category' }))

    expect(errorOf('Name')).toBe('Must be 100 characters or fewer.')
    expect(post).not.toHaveBeenCalled()
  })

  it('puts a problem with the slug made from the name on the name', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(validationFailed([['slug'], 'Use only lowercase letters, numbers and hyphens.']))
    const { user } = mount()

    await user.type(screen.getByLabelText('Name'), '!!!')
    await user.click(screen.getByRole('button', { name: 'Add category' }))

    await waitFor(() => { expect(errorOf('Name')).toBe('Use only lowercase letters, numbers and hyphens.') })
  })

  it('shows a duplicate name beside the button', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError("You already have a category called 'Food'.", 409, 'conflict'))
    const { user } = mount()

    await user.type(screen.getByLabelText('Name'), 'Food')
    await user.click(screen.getByRole('button', { name: 'Add category' }))

    expect((await screen.findByRole('alert')).textContent).toBe("You already have a category called 'Food'.")
  })
})
