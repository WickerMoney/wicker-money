import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

/**
 * Core pages other than the Dashboard are separate chunks. The shell sets the
 * tab title and moves focus to <main> on navigation, and that must not wait
 * for (or be lost to) the chunk download.
 */

const chunk = vi.hoisted(() => {
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => { release = resolve })
  return { gate, release }
})

vi.mock('./auth/index.js', () => ({ useAuth: () => ({ user: { id: 'u1', email: 'a@example.com', timezone: 'UTC', role: 'owner' } }) }))
vi.mock('./plugins/registry/index.js', () => ({ usePluginRegistry: () => ({ plugins: [], failures: [] }) }))
vi.mock('./onboarding/index.js', () => ({
  OnboardingProvider: ({ children }: { children: ReactNode }) => children,
  SetupWizard: () => null,
}))
vi.mock('./shell/AccountMenu.js', () => ({ AccountMenu: () => <div>account</div> }))
vi.mock('./pages/Dashboard/index.js', () => ({ Dashboard: () => <h1>Dashboard page</h1> }))
vi.mock('./pages/Accounts/index.js', async () => {
  await chunk.gate
  return { AccountsPage: () => <h1>Accounts page</h1> }
})

const { AuthenticatedRoutes } = await import('./AuthenticatedRoutes.js')

describe('lazy route chunks', () => {
  it('sets the title and focuses <main> at once, then swaps the spinner for the page', async () => {
    render(<MemoryRouter initialEntries={['/']}><AuthenticatedRoutes /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'Dashboard page' })).toBeTruthy()

    await userEvent.click(screen.getByRole('link', { name: 'Accounts' }))

    // The chunk is still downloading.
    expect(screen.getByRole('status').textContent).toBe('Loading Accounts')
    expect(screen.queryByRole('heading', { name: 'Accounts page' })).toBeNull()
    expect(document.title).toBe('Accounts - Wicker Money')
    expect(document.activeElement).toBe(screen.getByRole('main'))

    chunk.release()
    expect(await screen.findByRole('heading', { name: 'Accounts page' })).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
    expect(document.title).toBe('Accounts - Wicker Money')
    expect(document.activeElement).toBe(screen.getByRole('main'))
  })
})
