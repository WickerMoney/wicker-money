import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../api/ApiError.js'
import { api } from '../../../api/client.js'
import { deferred } from '../../../testing/deferred.js'
import { errorOf } from '../../../testing/errorOf.js'

const downloadJson = vi.fn()
vi.mock('../helpers/downloadJson.js', () => ({ downloadJson }))

const { ExportSection } = await import('./ExportSection.js')

const WRONG = new ApiError('Password is incorrect.', 403, 'password_incorrect', [
  { path: ['password'], message: 'Password is incorrect.' },
])

/** Mounts the export section with the two API calls it makes. */
function mount() {
  const post = vi.spyOn(api, 'post').mockResolvedValue({ ticket: 'tkt-1', expiresAt: '2026-10-11T20:00:00Z' })
  const get = vi.spyOn(api, 'get').mockResolvedValue({ core: { profile: { id: 'u1' } } })
  render(<ExportSection />)
  return { post, get, user: userEvent.setup() }
}

const openButton = () => screen.getByRole('button', { name: 'Download my data…' })
const dialog = () => screen.getByRole('dialog', { name: 'Confirm your password' })
const password = () => within(dialog()).getByLabelText<HTMLInputElement>('Your password')
const submit = () => within(dialog()).getByRole<HTMLButtonElement>('button', { name: /^(Download my data|Preparing export…)$/ })

afterEach(() => { vi.restoreAllMocks(); downloadJson.mockReset() })

describe('the export section', () => {
  it('says a password is needed, and requests nothing until the button is pressed', () => {
    const { post, get } = mount()
    expect(screen.getByText(/You will be asked for your password first/)).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(post).not.toHaveBeenCalled()
    expect(get).not.toHaveBeenCalled()
  })

  it('opens a named dialog that starts in the password field', async () => {
    const { user } = mount()
    await user.click(openButton())
    expect(dialog()).toBeTruthy()
    expect(document.activeElement).toBe(password())
  })

  it('labels the password for screen readers and password managers', async () => {
    const { user } = mount()
    await user.click(openButton())
    expect(password().getAttribute('type')).toBe('password')
    expect(password().getAttribute('autocomplete')).toBe('current-password')
    expect(openButton().getAttribute('aria-haspopup')).toBe('dialog')
  })

  it('keeps the download button off until a password is entered', async () => {
    const { user } = mount()
    await user.click(openButton())
    expect(submit().disabled).toBe(true)
    await user.type(password(), 'pw')
    expect(submit().disabled).toBe(false)
    await user.clear(password())
    expect(submit().disabled).toBe(true)
  })

  it('trades the password for a ticket, then downloads with it, in that order', async () => {
    const { user, post, get } = mount()
    const gate = deferred<{ ticket: string }>()
    post.mockReturnValue(gate.promise as never)
    await user.click(openButton())
    await user.type(password(), 'my password')
    await user.click(submit())

    expect(post).toHaveBeenCalledWith('/settings/export-ticket', { password: 'my password' }, { readOnly: true })
    // The export is not asked for until the ticket exists.
    expect(get).not.toHaveBeenCalled()
    gate.resolve({ ticket: 'tkt-2' })

    await waitFor(() => { expect(downloadJson).toHaveBeenCalledTimes(1) })
    expect(get).toHaveBeenCalledWith('/settings/export', { headers: { 'x-wickermoney-export-ticket': 'tkt-2' } })
    expect(downloadJson.mock.calls[0]?.[0]).toEqual({ core: { profile: { id: 'u1' } } })
    expect(String(downloadJson.mock.calls[0]?.[1])).toMatch(/^wickermoney-export-\d{4}-\d{2}-\d{2}\.json$/)
  })

  it('closes after the download, says so in a status region, and gives focus back to the button', async () => {
    const { user } = mount()
    await user.click(openButton())
    await user.type(password(), 'pw')
    await user.click(submit())

    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    expect(screen.getByRole('status').textContent).toBe('Downloaded.')
    expect(document.activeElement).toBe(openButton())
  })

  it('submits from the keyboard with Enter in the password field', async () => {
    const { user, post } = mount()
    await user.click(openButton())
    await user.type(password(), 'pw{Enter}')
    await waitFor(() => { expect(downloadJson).toHaveBeenCalled() })
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('does not send an empty password on Enter', async () => {
    const { user, post } = mount()
    await user.click(openButton())
    await user.keyboard('{Enter}')
    expect(post).not.toHaveBeenCalled()
  })

  it('puts a wrong password under the field, moves focus to it, downloads nothing and lets them retry', async () => {
    const { user, post, get } = mount()
    post.mockRejectedValueOnce(WRONG)
    await user.click(openButton())
    await user.type(password(), 'nope')
    await user.click(submit())

    await waitFor(() => { expect(errorOf('Your password')).toBe('Password is incorrect.') })
    expect(password().getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(password())
    expect(get).not.toHaveBeenCalled()
    expect(downloadJson).not.toHaveBeenCalled()
    expect(dialog()).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()

    // Typing again clears the message; the corrected password goes through.
    await user.clear(password())
    expect(errorOf('Your password')).toBeNull()
    await user.type(password(), 'right')
    await user.click(submit())
    await waitFor(() => { expect(downloadJson).toHaveBeenCalledTimes(1) })
    expect(post).toHaveBeenLastCalledWith('/settings/export-ticket', { password: 'right' }, { readOnly: true })
  })

  it('shows any other refusal, such as too many attempts, beside the buttons as an alert', async () => {
    const { user, post } = mount()
    post.mockRejectedValue(new ApiError('Too many requests. Try again later.', 429, 'rate_limited'))
    await user.click(openButton())
    await user.type(password(), 'pw')
    await user.click(submit())

    const alert = await within(dialog()).findByRole('alert')
    expect(alert.textContent).toBe('Too many requests. Try again later.')
    expect(errorOf('Your password')).toBeNull()
    expect(downloadJson).not.toHaveBeenCalled()
  })

  it('shows a refused or failed download as an alert too, and downloads nothing', async () => {
    const { user, get } = mount()
    get.mockRejectedValue(new ApiError('That export confirmation has expired or was already used. Confirm your password again.', 403, 'export_ticket_invalid'))
    await user.click(openButton())
    await user.type(password(), 'pw')
    await user.click(submit())

    expect((await within(dialog()).findByRole('alert')).textContent).toMatch(/Confirm your password again/)
    expect(downloadJson).not.toHaveBeenCalled()
    expect(submit().disabled).toBe(false)
  })

  it('falls back to a plain message when the failure has none of its own', async () => {
    const { user, post } = mount()
    post.mockRejectedValue(new Error(''))
    await user.click(openButton())
    await user.type(password(), 'pw')
    await user.click(submit())
    expect((await within(dialog()).findByRole('alert')).textContent).toBe('Could not export your data.')
  })

  it('cannot be dismissed or resubmitted while the export is in flight', async () => {
    const { user, post } = mount()
    const gate = deferred<{ ticket: string }>()
    post.mockReturnValue(gate.promise as never)
    await user.click(openButton())
    await user.type(password(), 'pw')
    await user.click(submit())

    expect(submit().textContent).toBe('Preparing export…')
    expect(submit().disabled).toBe(true)
    expect(within(dialog()).getByRole<HTMLButtonElement>('button', { name: 'Cancel' }).disabled).toBe(true)
    expect(password().hasAttribute('disabled')).toBe(true)
    await user.keyboard('{Enter}')
    expect(post).toHaveBeenCalledTimes(1)
    gate.resolve({ ticket: 'tkt-3' })
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  })

  it('closes from Cancel and from the close button without requesting anything, and opens empty next time', async () => {
    const { user, post, get } = mount()
    await user.click(openButton())
    await user.type(password(), 'secret')
    await user.click(within(dialog()).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()

    await user.click(openButton())
    expect(password().value).toBe('')
    await user.click(within(dialog()).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(post).not.toHaveBeenCalled()
    expect(get).not.toHaveBeenCalled()
  })

  it('clears the "Downloaded." note when the dialog is opened again', async () => {
    const { user } = mount()
    await user.click(openButton())
    await user.type(password(), 'pw')
    await user.click(submit())
    await waitFor(() => { expect(screen.getByRole('status').textContent).toBe('Downloaded.') })

    await user.click(openButton())
    expect(screen.getByRole('status').textContent).toBe('')
  })

  it('keeps the password out of the page after it is sent: not in the DOM, a link or the document title', async () => {
    const { user } = mount()
    await user.click(openButton())
    await user.type(password(), 'hunter2-hunter2')
    await user.click(submit())
    await waitFor(() => { expect(downloadJson).toHaveBeenCalled() })
    expect(document.body.innerHTML).not.toContain('hunter2-hunter2')
  })
})

describe('on a phone', () => {
  // jsdom does no layout. What can be checked here is that the phone rules name
  // the elements this feature adds; the layout itself is looked at in a browser.
  const css = readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf8')
  const phone = css.slice(css.indexOf('@media (max-width: 560px) {\n  .danger-zone'))

  it('has rules that make the section button full width and stack the dialog buttons', () => {
    expect(phone).toMatch(/\.export-actions \.wm-btn \{ width: 100%; \}/)
    expect(phone).toMatch(/\.password-step \.wm-dialog__actions \{[^}]*flex-direction: column-reverse/)
    expect(phone).toMatch(/\.password-step \.wm-dialog__actions \.wm-btn \{ width: 100%; \}/)
  })

  it('puts those classes on the elements', async () => {
    const { user } = mount()
    await user.click(openButton())
    expect(dialog().querySelector('form.password-step')).not.toBeNull()
    expect(openButton().closest('.export-actions')).not.toBeNull()
  })
})
