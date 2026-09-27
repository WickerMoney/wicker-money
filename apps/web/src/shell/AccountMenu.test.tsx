import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { THEME_STORAGE_KEY } from '../theme/index.js'
import { AccountMenu } from './AccountMenu.js'

const signOut = vi.fn(() => Promise.resolve())

vi.mock('../auth/index.js', () => ({
  useAuth: () => ({
    user: { id: 'u1', email: 'jeremy@example.com', timezone: 'America/New_York' },
    signOut,
  }),
}))

beforeEach(() => {
  signOut.mockClear()
})

afterEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

function renderMenu() {
  return render(<MemoryRouter><AccountMenu /></MemoryRouter>)
}

const trigger = () => screen.getByRole('button', { name: /jeremy@example\.com/ })

describe('AccountMenu', () => {
  it('shows the signed-in email with the menu closed', () => {
    renderMenu()
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('opens a menu offering the three themes and sign out', async () => {
    renderMenu()
    await userEvent.click(trigger())
    expect(screen.getByRole('menu')).toBeDefined()
    expect(screen.getAllByRole('menuitemradio').map((el) => el.getAttribute('aria-label')))
      .toEqual(['Light', 'Dark', 'System'])
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeDefined()
  })

  it('marks System as the choice when nothing was stored', async () => {
    renderMenu()
    await userEvent.click(trigger())
    expect(screen.getByRole('menuitemradio', { name: 'System' }).getAttribute('aria-checked')).toBe('true')
  })

  it('applies and remembers a chosen theme, then returns to system', async () => {
    renderMenu()
    await userEvent.click(trigger())

    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Dark' }))
    expect(document.documentElement.dataset['theme']).toBe('dark')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    expect(screen.getByRole('menuitemradio', { name: 'Dark' }).getAttribute('aria-checked')).toBe('true')

    await userEvent.click(screen.getByRole('menuitemradio', { name: 'System' }))
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('system')
  })

  it('starts from the remembered theme', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light')
    renderMenu()
    expect(document.documentElement.dataset['theme']).toBe('light')
    await userEvent.click(trigger())
    expect(screen.getByRole('menuitemradio', { name: 'Light' }).getAttribute('aria-checked')).toBe('true')
  })

  it('closes on Escape and returns focus to the trigger', async () => {
    renderMenu()
    await userEvent.click(trigger())
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger())
  })

  it('closes on a click outside the menu', async () => {
    renderMenu()
    await userEvent.click(trigger())
    await userEvent.click(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('signs out', async () => {
    renderMenu()
    await userEvent.click(trigger())
    await userEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }))
    expect(signOut).toHaveBeenCalledOnce()
  })
})
