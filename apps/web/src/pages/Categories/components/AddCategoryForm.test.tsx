import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../api/ApiError.js'
import { api } from '../../../api/client.js'
import { errorOf } from '../../../testing/errorOf.js'
import { makeCategory } from '../../../testing/makeCategory.js'
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

  it('tells the page which parent a new category went under, so it can open it', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({})
    const onCreated = vi.fn()
    const food = makeCategory({ id: 'food', name: 'Food' })
    render(<AddCategoryForm parents={[food]} status={makeStatus()} onChanged={async () => {}} onCreated={onCreated} />)
    const user = userEvent.setup()

    await user.type(screen.getByLabelText('Name'), 'Dining')
    await user.selectOptions(screen.getByLabelText('Under'), 'food')
    await user.click(screen.getByRole('button', { name: 'Add category' }))
    await waitFor(() => { expect(onCreated).toHaveBeenCalledWith('food') })

    await user.type(screen.getByLabelText('Name'), 'Pets')
    await user.selectOptions(screen.getByLabelText('Under'), '')
    await user.click(screen.getByRole('button', { name: 'Add category' }))
    await waitFor(() => { expect(onCreated).toHaveBeenLastCalledWith(null) })
  })

  it('does not report a category that failed to save', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError('Nope.', 409, 'conflict'))
    const onCreated = vi.fn()
    render(<AddCategoryForm parents={[]} status={makeStatus()} onChanged={async () => {}} onCreated={onCreated} />)

    await userEvent.setup().type(screen.getByLabelText('Name'), 'Food')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Add category' }))
    await screen.findByRole('alert')
    expect(onCreated).not.toHaveBeenCalled()
  })
})
