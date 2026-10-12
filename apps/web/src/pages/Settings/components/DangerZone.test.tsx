import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../api/ApiError.js'
import { api } from '../../../api/client.js'
import { AuthCtx } from '../../../auth/authContext.js'
import type { AuthState } from '../../../auth/AuthState.js'
import { deferred } from '../../../testing/deferred.js'
import { errorOf } from '../../../testing/errorOf.js'
import type { InstanceEraseCheck } from '../state/InstanceEraseCheck.js'

const downloadJson = vi.fn()
vi.mock('../helpers/downloadJson.js', () => ({ downloadJson }))

const { DangerZone } = await import('./DangerZone.js')

const CHECK: InstanceEraseCheck = {
  databaseName: 'wickermoney', registrationEnabled: true, bootstrapOwnerEmail: null,
  otherSessions: 0, otherUsers: 0, blocker: null,
}

/** Mounts the danger zone for a signed-in user and routes the API calls the dialogs make. */
function mount(role: 'owner' | 'member' = 'owner', check: InstanceEraseCheck = CHECK) {
  const signOut = vi.fn(async () => {})
  const auth: AuthState = {
    user: { id: 'u1', email: 'me@example.com', timezone: 'UTC', role }, ready: true,
    signIn: vi.fn(), register: vi.fn(), setTimezone: vi.fn(), refreshUser: vi.fn(), signOut,
  }
  const post = vi.spyOn(api, 'post').mockImplementation(async (path: string) => (
    path === '/settings/export-ticket' ? { ticket: 'tkt' } : undefined
  ) as never)
  const get = vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path === '/settings/erase-instance') return check
    if (path === '/settings/export') return { accounts: [] }
    throw new Error(`unexpected GET ${path}`)
  })
  render(<AuthCtx.Provider value={auth}><DangerZone /></AuthCtx.Provider>)
  return { signOut, post, get, user: userEvent.setup() }
}

const dialog = () => screen.getByRole('dialog')
const confirmButton = (name: string) => within(dialog()).getByRole<HTMLButtonElement>('button', { name })

afterEach(() => { vi.restoreAllMocks(); downloadJson.mockReset() })

describe('the danger zone sections', () => {
  it('shows "Erase my data" to a member and no instance section', () => {
    mount('member')
    expect(screen.getByRole('heading', { name: 'Erase my data' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Erase this entire instance' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Erase this instance/ })).toBeNull()
  })

  it('shows an owner two separate sections, each with its own button', () => {
    mount('owner')
    expect(screen.getByRole('heading', { name: 'Erase my data' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Erase this entire instance' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Erase my data…' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Erase this instance…' })).toBeTruthy()
  })

  it('opens nothing and calls nothing until a button is pressed', () => {
    const { post, get } = mount('owner')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(post).not.toHaveBeenCalled()
    expect(get).not.toHaveBeenCalled()
  })
})

describe('Erase my data', () => {
  async function open() {
    const m = mount('member')
    await m.user.click(screen.getByRole('button', { name: 'Erase my data…' }))
    return m
  }

  it('is a named dialog that starts in the confirmation field and says whose data goes', async () => {
    await open()
    expect(screen.getByRole('dialog', { name: 'Erase my data' })).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByLabelText('Type "erase my data" to confirm'))
    expect(dialog().textContent).toContain('me@example.com')
  })

  it('keeps the red button off until the phrase and a password are both entered', async () => {
    const { user } = await open()
    const button = () => confirmButton('Erase my data')
    expect(button().disabled).toBe(true)

    await user.type(screen.getByLabelText('Type "erase my data" to confirm'), 'erase my dat')
    await user.type(screen.getByLabelText('Your password'), 'pw')
    expect(button().disabled).toBe(true)

    await user.type(screen.getByLabelText('Type "erase my data" to confirm'), 'a')
    expect(button().disabled).toBe(false)

    await user.clear(screen.getByLabelText('Your password'))
    expect(button().disabled).toBe(true)
  })

  it('accepts the phrase in any case with spaces around it, and sends it as typed', async () => {
    const { user, post } = await open()
    await user.type(screen.getByLabelText('Type "erase my data" to confirm'), '  ERASE My Data ')
    await user.type(screen.getByLabelText('Your password'), 'pw')
    await user.click(confirmButton('Erase my data'))

    expect(post).toHaveBeenCalledWith('/settings/erase-my-data', { password: 'pw', confirmation: '  ERASE My Data ' })
  })

  it('does not accept the instance phrase', async () => {
    const { user } = await open()
    await user.type(screen.getByLabelText('Type "erase my data" to confirm'), 'erase this instance')
    await user.type(screen.getByLabelText('Your password'), 'pw')
    expect(confirmButton('Erase my data').disabled).toBe(true)
  })

  it('signs out after the erase, and not before', async () => {
    const gate = deferred<undefined>()
    const { user, post, signOut } = await open()
    post.mockReturnValue(gate.promise)
    await user.type(screen.getByLabelText('Type "erase my data" to confirm'), 'erase my data')
    await user.type(screen.getByLabelText('Your password'), 'pw')
    await user.click(confirmButton('Erase my data'))

    expect(confirmButton('Erasing…').disabled).toBe(true)
    expect(signOut).not.toHaveBeenCalled()

    gate.resolve(undefined)
    await waitFor(() => { expect(signOut).toHaveBeenCalledTimes(1) })
  })

  it('still finishes when the logout call itself fails, because the server already ended the session', async () => {
    const { user, signOut } = await open()
    signOut.mockRejectedValue(new ApiError('Unauthorized', 401, 'unauthorized'))
    await user.type(screen.getByLabelText('Type "erase my data" to confirm'), 'erase my data')
    await user.type(screen.getByLabelText('Your password'), 'pw')
    await user.click(confirmButton('Erase my data'))

    await waitFor(() => { expect(signOut).toHaveBeenCalled() })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('puts a wrong password under the password field, stays open, signs nobody out and lets them retry', async () => {
    const { user, post, signOut } = await open()
    post.mockRejectedValueOnce(new ApiError('Password is incorrect.', 403, 'password_incorrect', [
      { path: ['password'], message: 'Password is incorrect.' },
    ]))
    await user.type(screen.getByLabelText('Type "erase my data" to confirm'), 'erase my data')
    await user.type(screen.getByLabelText('Your password'), 'nope')
    await user.click(confirmButton('Erase my data'))

    await waitFor(() => { expect(errorOf('Your password')).toBe('Password is incorrect.') })
    expect(screen.getByLabelText('Your password').getAttribute('aria-invalid')).toBe('true')
    expect(signOut).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()

    await user.clear(screen.getByLabelText('Your password'))
    await user.type(screen.getByLabelText('Your password'), 'right')
    expect(errorOf('Your password')).toBeNull()
    await user.click(confirmButton('Erase my data'))
    await waitFor(() => { expect(signOut).toHaveBeenCalled() })
  })

  it('shows any other refusal beside the button as an alert', async () => {
    const { user, post } = await open()
    post.mockRejectedValue(new ApiError('Too many attempts. Try again later.', 429, 'rate_limited'))
    await user.type(screen.getByLabelText('Type "erase my data" to confirm'), 'erase my data')
    await user.type(screen.getByLabelText('Your password'), 'pw')
    await user.click(confirmButton('Erase my data'))

    expect((await screen.findByRole('alert')).textContent).toBe('Too many attempts. Try again later.')
  })

  const exportDialog = () => screen.getByRole('dialog', { name: 'Confirm your password' })

  async function startExport(user: ReturnType<typeof userEvent.setup>) {
    await user.click(within(dialog()).getByRole('button', { name: 'Download my data first…' }))
    await user.type(within(exportDialog()).getByLabelText('Your password'), 'export-pw')
  }

  it('offers the export first, asks for the password in its own dialog, and downloads without erasing anything', async () => {
    const { user, get, post } = await open()
    await user.click(within(dialog()).getByRole('button', { name: 'Download my data first…' }))
    expect(within(exportDialog()).getByText(/Enter your password to download/)).toBeTruthy()
    // Nothing is requested until the password is entered and sent.
    expect(post).not.toHaveBeenCalled()
    expect(get).not.toHaveBeenCalled()

    await user.type(within(exportDialog()).getByLabelText('Your password'), 'export-pw')
    await user.click(within(exportDialog()).getByRole('button', { name: 'Download my data' }))

    await waitFor(() => { expect(downloadJson).toHaveBeenCalledTimes(1) })
    expect(post).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledWith('/settings/export-ticket', { password: 'export-pw' }, { readOnly: true })
    expect(get).toHaveBeenCalledWith('/settings/export', { headers: { 'x-wickermoney-export-ticket': 'tkt' } })
    expect(downloadJson.mock.calls[0]?.[0]).toEqual({ accounts: [] })
    expect(await within(dialog()).findByText('Downloaded.')).toBeTruthy()
    expect(post).not.toHaveBeenCalledWith('/settings/erase-my-data', expect.anything())
    // The password step is gone; the erase dialog is where it was.
    expect(screen.queryByRole('dialog', { name: 'Confirm your password' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Erase my data' })).toBeTruthy()
  })

  it('puts a wrong export password under the password field of the export dialog, not the erase dialog', async () => {
    const { user, post, get } = await open()
    post.mockRejectedValueOnce(new ApiError('Password is incorrect.', 403, 'password_incorrect', [
      { path: ['password'], message: 'Password is incorrect.' },
    ]))
    await startExport(user)
    await user.click(within(exportDialog()).getByRole('button', { name: 'Download my data' }))

    await waitFor(() => { expect(within(exportDialog()).getByLabelText('Your password').getAttribute('aria-invalid')).toBe('true') })
    expect(get).not.toHaveBeenCalled()
    expect(downloadJson).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Erase my data' })).toBeTruthy()
  })

  it('reports a failed export beside the export buttons without closing, downloading or erasing', async () => {
    const { user, get, post } = await open()
    get.mockRejectedValue(new Error('Export failed.'))
    await startExport(user)
    await user.click(within(exportDialog()).getByRole('button', { name: 'Download my data' }))

    expect((await within(exportDialog()).findByRole('alert')).textContent).toBe('Export failed.')
    expect(downloadJson).not.toHaveBeenCalled()
    expect(post).not.toHaveBeenCalledWith('/settings/erase-my-data', expect.anything())
    expect(screen.getByRole('dialog', { name: 'Erase my data' })).toBeTruthy()
  })

  it('never lets Enter in the export password box submit the erase form behind it', async () => {
    const { user, post, signOut } = await open()
    // The erase form is complete, so a leaked submit event would erase for real.
    await user.type(screen.getByLabelText('Type "erase my data" to confirm'), 'erase my data')
    await user.type(within(dialog()).getByLabelText('Your password'), 'erase-pw')
    await user.click(within(dialog()).getByRole('button', { name: 'Download my data first…' }))
    await user.type(within(exportDialog()).getByLabelText('Your password'), 'export-pw{Enter}')

    await waitFor(() => { expect(downloadJson).toHaveBeenCalledTimes(1) })
    expect(post.mock.calls.map((c) => c[0])).toEqual(['/settings/export-ticket'])
    expect(signOut).not.toHaveBeenCalled()
  })

  it('closing the export step, even with the dialog\'s own close event, leaves the erase dialog open', async () => {
    // A browser fires `close` on the top dialog when Escape is pressed; React passes that event up to
    // every enclosing dialog's onClose unless it is stopped, which would close the erase dialog too.
    const { user } = await open()
    await user.type(screen.getByLabelText('Type "erase my data" to confirm'), 'erase my data')
    await user.click(within(dialog()).getByRole('button', { name: 'Download my data first…' }))
    fireEvent(exportDialog(), new Event('close'))

    expect(screen.queryByRole('dialog', { name: 'Confirm your password' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Erase my data' })).toBeTruthy()
    expect((screen.getByLabelText('Type "erase my data" to confirm') as HTMLInputElement).value).toBe('erase my data')
  })

  it('keeps what was typed in the erase form when the export step is cancelled', async () => {
    const { user, post } = await open()
    await user.type(screen.getByLabelText('Type "erase my data" to confirm'), 'erase my data')
    await user.click(within(dialog()).getByRole('button', { name: 'Download my data first…' }))
    await user.click(within(exportDialog()).getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog', { name: 'Confirm your password' })).toBeNull()
    expect((screen.getByLabelText('Type "erase my data" to confirm') as HTMLInputElement).value).toBe('erase my data')
    expect(post).not.toHaveBeenCalled()
  })

  it('closes from Cancel and from the close button without sending anything, then opens fresh', async () => {
    const { user, post } = await open()
    await user.type(screen.getByLabelText('Your password'), 'secret')
    await user.click(within(dialog()).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Erase my data…' }))
    expect((screen.getByLabelText('Your password') as HTMLInputElement).value).toBe('')
    await user.click(within(dialog()).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(post).not.toHaveBeenCalled()
  })

  it('cannot be dismissed or resubmitted while the erase is in flight', async () => {
    const gate = deferred<undefined>()
    const { user, post } = await open()
    post.mockReturnValue(gate.promise)
    await user.type(screen.getByLabelText('Type "erase my data" to confirm'), 'erase my data')
    await user.type(screen.getByLabelText('Your password'), 'pw')
    await user.click(confirmButton('Erase my data'))

    expect(within(dialog()).getByRole<HTMLButtonElement>('button', { name: 'Cancel' }).disabled).toBe(true)
    expect(screen.getByLabelText('Your password').hasAttribute('disabled')).toBe(true)
    await user.keyboard('{Enter}')
    expect(post).toHaveBeenCalledTimes(1)
    gate.resolve(undefined)
  })

  it('submits from the keyboard with Enter in the password field', async () => {
    const { user, post } = await open()
    await user.type(screen.getByLabelText('Type "erase my data" to confirm'), 'erase my data')
    await user.type(screen.getByLabelText('Your password'), 'pw{Enter}')
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('labels the password as a current-password field and the phrase as free text, for password managers and spellcheck', async () => {
    await open()
    const password = screen.getByLabelText('Your password')
    expect(password.getAttribute('type')).toBe('password')
    expect(password.getAttribute('autocomplete')).toBe('current-password')
    expect(screen.getByLabelText('Type "erase my data" to confirm').getAttribute('autocomplete')).toBe('off')
  })
})

describe('Erase this entire instance', () => {
  async function open(check: InstanceEraseCheck = CHECK) {
    const m = mount('owner', check)
    await m.user.click(screen.getByRole('button', { name: 'Erase this instance…' }))
    return m
  }
  const fill = async (user: ReturnType<typeof userEvent.setup>, phrase = 'erase this instance') => {
    await user.type(screen.getByLabelText(`Type "erase this instance" to confirm`), phrase)
    await user.type(screen.getByLabelText('Your password'), 'pw')
  }

  it('reads the preflight when it opens and names the database', async () => {
    const { get } = await open()
    expect(await within(dialog()).findByText('wickermoney')).toBeTruthy()
    expect(get).toHaveBeenCalledWith('/settings/erase-instance')
    expect(screen.getByRole('dialog', { name: 'Erase this entire instance' })).toBeTruthy()
  })

  it('keeps the button off until the preflight has loaded, even with the right words', async () => {
    const gate = deferred<InstanceEraseCheck>()
    const m = mount('owner')
    m.get.mockReturnValue(gate.promise)
    await m.user.click(screen.getByRole('button', { name: 'Erase this instance…' }))
    await fill(m.user)
    expect(confirmButton('Erase this instance').disabled).toBe(true)

    gate.resolve(CHECK)
    await waitFor(() => { expect(confirmButton('Erase this instance').disabled).toBe(false) })
  })

  it('does not accept the "erase my data" phrase', async () => {
    const { user } = await open()
    await within(dialog()).findByText('wickermoney')
    await fill(user, 'erase my data')
    expect(confirmButton('Erase this instance').disabled).toBe(true)
  })

  it('sends the password, the phrase and acknowledgeActiveSessions: false when nobody else is signed in', async () => {
    const { user, post, signOut } = await open()
    await within(dialog()).findByText('wickermoney')
    await fill(user)
    await user.click(confirmButton('Erase this instance'))

    expect(post).toHaveBeenCalledWith('/settings/erase-instance', {
      password: 'pw', confirmation: 'erase this instance', acknowledgeActiveSessions: false,
    })
    await waitFor(() => { expect(signOut).toHaveBeenCalledTimes(1) })
  })

  it('needs an explicit tick while other sessions are live, and says how many people it affects', async () => {
    const { user, post } = await open({ ...CHECK, otherSessions: 3, otherUsers: 2 })
    const tick = await within(dialog()).findByRole<HTMLInputElement>('checkbox')
    expect(tick.parentElement?.textContent).toContain('3 other sessions (2 other people) will be signed out')
    await fill(user)
    expect(confirmButton('Erase this instance').disabled).toBe(true)

    await user.click(tick)
    expect(confirmButton('Erase this instance').disabled).toBe(false)
    await user.click(confirmButton('Erase this instance'))
    expect(post).toHaveBeenCalledWith('/settings/erase-instance', expect.objectContaining({ acknowledgeActiveSessions: true }))
  })

  it('words one other session on the same account in the singular', async () => {
    await open({ ...CHECK, otherSessions: 1, otherUsers: 0 })
    const tick = await within(dialog()).findByRole('checkbox')
    expect(tick.parentElement?.textContent).toContain('1 other session, all on your own account will be signed out')
  })

  it('offers no tick when nobody else is signed in', async () => {
    await open()
    await within(dialog()).findByText('wickermoney')
    expect(within(dialog()).queryByRole('checkbox')).toBeNull()
  })

  it.each([
    ['registration_disabled', { registrationEnabled: false }, /REGISTRATION_ENABLED=false/],
    ['bootstrap_owner_mismatch', { bootstrapOwnerEmail: 'boss@example.com' }, /BOOTSTRAP_OWNER_EMAIL is set to boss@example\.com/],
  ] as const)('explains the %s blocker and refuses to proceed', async (blocker, extra, message) => {
    const { user, post } = await open({ ...CHECK, ...extra, blocker })
    expect((await within(dialog()).findByRole('alert')).textContent).toMatch(message)
    await fill(user)
    expect(confirmButton('Erase this instance').disabled).toBe(true)
    await user.keyboard('{Enter}')
    expect(post).not.toHaveBeenCalled()
  })

  it('shows a failed preflight as an alert and does not allow the erase', async () => {
    const m = mount('owner')
    m.get.mockRejectedValue(new ApiError('Owner only.', 403, 'owner_required'))
    await m.user.click(screen.getByRole('button', { name: 'Erase this instance…' }))
    expect((await within(dialog()).findByRole('alert')).textContent).toBe('Owner only.')
    await fill(m.user)
    expect(confirmButton('Erase this instance').disabled).toBe(true)
  })

  it('reloads the counts when the server says someone signed in since, and asks for the tick again', async () => {
    const { user, post, get } = await open()
    await within(dialog()).findByText('wickermoney')
    await fill(user)
    post.mockRejectedValueOnce(new ApiError('1 other session is signed in.', 409, 'active_sessions'))
    get.mockImplementation(async () => ({ ...CHECK, otherSessions: 1, otherUsers: 1 }))
    await user.click(confirmButton('Erase this instance'))

    expect((await screen.findAllByRole('alert')).some((a) => a.textContent?.includes('1 other session is signed in.'))).toBe(true)
    const tick = await within(dialog()).findByRole<HTMLInputElement>('checkbox')
    expect(tick.checked).toBe(false)
    expect(confirmButton('Erase this instance').disabled).toBe(true)
  })

  it('puts a wrong password under the password field and does not sign out', async () => {
    const { user, post, signOut } = await open()
    await within(dialog()).findByText('wickermoney')
    post.mockRejectedValue(new ApiError('Password is incorrect.', 403, 'password_incorrect', [
      { path: ['password'], message: 'Password is incorrect.' },
    ]))
    await fill(user)
    await user.click(confirmButton('Erase this instance'))

    await waitFor(() => { expect(errorOf('Your password')).toBe('Password is incorrect.') })
    expect(signOut).not.toHaveBeenCalled()
  })

  it('says the export covers only the owner\'s own data', async () => {
    await open()
    expect(dialog().textContent).toContain('your own data only')
  })

  it('sends nothing when it is cancelled', async () => {
    const { user, post } = await open()
    await within(dialog()).findByText('wickermoney')
    await user.click(within(dialog()).getByRole('button', { name: 'Cancel' }))
    expect(post).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('asks for the password before its own export download, the same way, and erases nothing', async () => {
    const { user, post, get } = await open()
    await within(dialog()).findByText('wickermoney')
    await user.click(within(dialog()).getByRole('button', { name: 'Download my data first…' }))
    const step = screen.getByRole('dialog', { name: 'Confirm your password' })
    await user.type(within(step).getByLabelText('Your password'), 'export-pw')
    await user.click(within(step).getByRole('button', { name: 'Download my data' }))

    await waitFor(() => { expect(downloadJson).toHaveBeenCalledTimes(1) })
    expect(post.mock.calls.map((c) => c[0])).toEqual(['/settings/export-ticket'])
    expect(get).toHaveBeenCalledWith('/settings/export', { headers: { 'x-wickermoney-export-ticket': 'tkt' } })
  })
})
