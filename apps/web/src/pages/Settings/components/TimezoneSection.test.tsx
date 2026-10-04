import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { AuthCtx } from '../../../auth/authContext.js'
import type { AuthState } from '../../../auth/AuthState.js'
import type { CurrentUser } from '../../../auth/CurrentUser.js'
import { TimezoneSection } from './TimezoneSection.js'

const BROWSER = Intl.DateTimeFormat().resolvedOptions().timeZone

/** Renders the section under a real-enough auth context whose `setTimezone` updates the user. */
function mount(start: string, setTimezone = vi.fn(async (z: string) => z)) {
  function Host() {
    const [user, setUser] = useState<CurrentUser>({ id: 'u1', email: 'a@example.com', timezone: start, role: 'owner' })
    const value: AuthState = {
      user, ready: true,
      signIn: vi.fn(), register: vi.fn(), signOut: vi.fn(),
      setTimezone: async (zone) => { setUser({ ...user, timezone: await setTimezone(zone) }) },
    }
    return <AuthCtx.Provider value={value}><TimezoneSection /></AuthCtx.Provider>
  }
  render(<Host />)
  return setTimezone
}

describe('TimezoneSection', () => {
  it("shows the account's zone and saves a new choice", async () => {
    const save = mount(BROWSER)
    const select = screen.getByLabelText<HTMLSelectElement>('Time zone')
    expect(select.value).toBe(BROWSER)
    const other = BROWSER === 'Asia/Tokyo' ? 'Europe/London' : 'Asia/Tokyo'

    await userEvent.selectOptions(select, other)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(save).toHaveBeenCalledWith(other)
    expect(await screen.findByText('Saved.')).toBeTruthy()
  })

  it("offers the browser's zone when the account is on another one", async () => {
    const away = BROWSER === 'UTC' ? 'Asia/Tokyo' : 'UTC'
    const save = mount(away)
    expect(screen.getByRole('status').textContent).toContain(`uses ${away.replaceAll('_', ' ')}`)

    await userEvent.click(screen.getByRole('button', { name: `Use ${BROWSER.replaceAll('_', ' ')}` }))

    expect(save).toHaveBeenCalledWith(BROWSER)
    await waitFor(() => { expect(screen.queryByRole('button', { name: `Use ${BROWSER.replaceAll('_', ' ')}` })).toBeNull() })
  })

  it('says nothing about a mismatch when the zones agree, and Save starts disabled', () => {
    mount(BROWSER)
    expect(screen.queryByText(/This browser is on/)).toBeNull()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save' }).disabled).toBe(true)
  })

  it('shows the server error and keeps the old zone', async () => {
    const save = vi.fn(async () => { throw new Error('timezone: not a known IANA time zone') })
    mount(BROWSER, save)
    const other = BROWSER === 'Asia/Tokyo' ? 'Europe/London' : 'Asia/Tokyo'
    await userEvent.selectOptions(screen.getByLabelText('Time zone'), other)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect((await screen.findByRole('alert')).textContent).toContain('not a known IANA time zone')
  })
})
