import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/ApiError.js'
import { errorOf } from '../testing/errorOf.js'
import { validationFailed } from '../testing/validationFailed.js'
import { AuthCtx } from './authContext.js'
import type { AuthState } from './AuthState.js'
import { AuthPage } from './AuthPage.js'

function mount(over: Partial<AuthState> = {}) {
  const value: AuthState = {
    user: null, ready: true,
    signIn: vi.fn(async () => {}), register: vi.fn(async () => {}), signOut: vi.fn(async () => {}),
    setTimezone: vi.fn(async () => {}), refreshUser: vi.fn(async () => {}), ...over,
  }
  render(<AuthCtx.Provider value={value}><AuthPage /></AuthCtx.Provider>)
  return { value, user: userEvent.setup() }
}

describe('AuthPage', () => {
  it('refuses a short new password under the password, without sending it', async () => {
    const { value, user } = mount()
    await user.click(screen.getByRole('button', { name: 'Create an account' }))

    await user.type(screen.getByLabelText('Email'), 'me@example.com')
    await user.type(screen.getByLabelText('Password'), 'short')
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(errorOf('Password')).toBe('Password must be at least 12 characters.')
    expect(document.activeElement).toBe(screen.getByLabelText('Password'))
    expect(value.register).not.toHaveBeenCalled()
  })

  it("puts the server's issue on the email", async () => {
    const { user } = mount({
      register: vi.fn(async () => { throw validationFailed([['email'], 'Must be an email address.']) }),
    })
    await user.click(screen.getByRole('button', { name: 'Create an account' }))

    await user.type(screen.getByLabelText('Email'), 'me@localhost')
    await user.type(screen.getByLabelText('Password'), 'a long enough passphrase')
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => { expect(errorOf('Email')).toBe('Must be an email address.') })
  })

  it('shows wrong credentials beside the buttons', async () => {
    const { user } = mount({
      signIn: vi.fn(async () => { throw new ApiError('Invalid email or password.', 401, 'unauthorized') }),
    })

    await user.type(screen.getByLabelText('Email'), 'me@example.com')
    await user.type(screen.getByLabelText('Password'), 'whatever')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect((await screen.findByRole('alert')).textContent).toBe('Invalid email or password.')
  })
})
