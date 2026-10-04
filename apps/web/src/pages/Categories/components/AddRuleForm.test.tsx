import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../../api/client.js'
import { errorOf } from '../../../testing/errorOf.js'
import { makeCategory } from '../../../testing/makeCategory.js'
import { makeStatus } from '../../../testing/makeStatus.js'
import { validationFailed } from '../../../testing/validationFailed.js'
import { AddRuleForm } from './AddRuleForm.js'

const categories = [makeCategory({ id: '00000000-0000-4000-8000-000000000001', name: 'Car' })]

function mount() {
  const status = makeStatus()
  const onChanged = vi.fn(async () => {})
  render(<AddRuleForm categories={categories} status={status} onChanged={onChanged} />)
  return { status, onChanged, user: userEvent.setup() }
}

async function chooseRange(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByLabelText('Condition'), 'amount_range')
}

afterEach(() => { vi.restoreAllMocks() })

describe('checking in the browser', () => {
  it('reads "At least 0" as no minimum and says a range still needs a bound, under the field', async () => {
    const post = vi.spyOn(api, 'post')
    const { user } = mount()
    await chooseRange(user)

    await user.type(screen.getByLabelText('At least'), '0')
    await user.click(screen.getByRole('button', { name: 'Save rule' }))

    expect(errorOf('At least')).toBe('Set a minimum, a maximum, or both.')
    expect(screen.getByLabelText('At least').getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(screen.getByLabelText('At least'))
    expect(post).not.toHaveBeenCalled()
  })

  it('sends "At least 0, at most 50" as a range with no minimum', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ recategorized: 0 })
    const { user } = mount()
    await chooseRange(user)

    await user.type(screen.getByLabelText('At least'), '0')
    await user.type(screen.getByLabelText('At most'), '50')
    await user.click(screen.getByRole('button', { name: 'Save rule' }))

    await waitFor(() => { expect(post).toHaveBeenCalled() })
    expect(post.mock.calls[0]?.[1]).toMatchObject({
      conditions: [{ conditionType: 'amount_range', direction: 'out', amountMax: '50' }],
    })
    expect((post.mock.calls[0]?.[1] as { conditions: object[] }).conditions[0]).not.toHaveProperty('amountMin')
  })

  it('refuses a fifth decimal place and a maximum under the minimum, each on its own field', async () => {
    const post = vi.spyOn(api, 'post')
    const { user } = mount()
    await chooseRange(user)

    await user.type(screen.getByLabelText('At least'), '20.12345')
    await user.type(screen.getByLabelText('At most'), '10')
    await user.click(screen.getByRole('button', { name: 'Preview' }))

    expect(errorOf('At least')).toBe('Enter an amount like 12.50, with no more than 4 decimal places.')
    expect(errorOf('At most')).toBeNull()
    expect(post).not.toHaveBeenCalled()

    await user.clear(screen.getByLabelText('At least'))
    await user.type(screen.getByLabelText('At least'), '20')
    await user.click(screen.getByRole('button', { name: 'Preview' }))

    expect(errorOf('At least')).toBeNull()
    expect(errorOf('At most')).toBe('Cannot be less than the minimum.')
  })

  it('clears a field\'s message once it is edited', async () => {
    const { user } = mount()
    await user.type(screen.getByLabelText('Priority'), 'x')
    await user.type(screen.getByLabelText('Text'), 'FUEL')
    await user.click(screen.getByRole('button', { name: 'Save rule' }))
    expect(errorOf('Priority')).toBe('Must be a whole number.')

    await user.type(screen.getByLabelText('Priority'), '{backspace}')

    expect(errorOf('Priority')).toBeNull()
  })
})

describe('errors from the server', () => {
  it('puts an issue on the field its path names', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(
      validationFailed([['conditions', 0, 'amountMax'], 'Must be more than 0. Leave it empty for no maximum.']),
    )
    const { user, status } = mount()
    await chooseRange(user)
    await user.type(screen.getByLabelText('At most'), '5')

    await user.click(screen.getByRole('button', { name: 'Save rule' }))

    await waitFor(() => { expect(errorOf('At most')).toBe('Must be more than 0. Leave it empty for no maximum.') })
    expect(status.show).not.toHaveBeenCalledWith(expect.stringContaining('amountMax'))
  })

  it('shows a refusal that is not about one field beside the buttons, and focuses it', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(validationFailed([[], 'Category not found.']))
    const { user } = mount()
    await user.type(screen.getByLabelText('Text'), 'FUEL')

    await user.click(screen.getByRole('button', { name: 'Save rule' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('Category not found.')
    expect(document.activeElement).toBe(alert)
  })
})
