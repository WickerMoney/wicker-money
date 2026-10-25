import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { ToastProvider, useToast } from '@wickermoney/ui-kit'
import { describe, expect, it, vi } from 'vitest'
import { AppShell } from './AppShell.js'

vi.mock('./AccountMenu.js', () => ({ AccountMenu: () => <div>account</div> }))

function renderShell() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route element={<AppShell plugins={[]} />}>
          <Route index element={<p>Dashboard page</p>} />
          <Route path="accounts" element={<p>Accounts page</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

const menuButton = () => screen.getByRole('button', { name: 'Menu' })
const main = () => screen.getByRole('main')

describe('AppShell phone drawer', () => {
  it('starts closed, with the page interactive', () => {
    renderShell()
    expect(menuButton().getAttribute('aria-expanded')).toBe('false')
    expect(menuButton().getAttribute('aria-controls')).toBe('shell-nav')
    expect(main().hasAttribute('inert')).toBe(false)
  })

  it('opens from the menu button, moves focus into the navigation and makes the page inert', async () => {
    renderShell()
    await userEvent.click(menuButton())
    expect(menuButton().getAttribute('aria-expanded')).toBe('true')
    expect(main().hasAttribute('inert')).toBe(true)
    expect(document.getElementById('shell-nav')).toBe(document.activeElement)
  })

  it('closes on Escape and returns focus to the menu button', async () => {
    renderShell()
    await userEvent.click(menuButton())
    await userEvent.keyboard('{Escape}')
    expect(menuButton().getAttribute('aria-expanded')).toBe('false')
    expect(main().hasAttribute('inert')).toBe(false)
    expect(document.activeElement).toBe(menuButton())
  })

  it('keeps Tab inside the open drawer, including the skip link outside it', async () => {
    renderShell()
    await userEvent.click(menuButton())
    const nav = document.getElementById('shell-nav')!
    for (let i = 0; i < 15; i++) { await userEvent.tab(); expect(nav.contains(document.activeElement)).toBe(true) }
    for (let i = 0; i < 15; i++) { await userEvent.tab({ shift: true }); expect(nav.contains(document.activeElement)).toBe(true) }
  })

  it('closes after following a link to another page', async () => {
    renderShell()
    await userEvent.click(menuButton())
    await userEvent.click(screen.getByRole('link', { name: 'Accounts' }))
    expect(screen.getByText('Accounts page')).toBeDefined()
    expect(menuButton().getAttribute('aria-expanded')).toBe('false')
  })

  it('closes after tapping the link for the page you are already on', async () => {
    renderShell()
    await userEvent.click(menuButton())
    await userEvent.click(screen.getByRole('link', { name: 'Dashboard' }))
    expect(menuButton().getAttribute('aria-expanded')).toBe('false')
  })
})

describe('AppShell accessibility', () => {
  it('sets the tab title from the route and updates it on navigation', async () => {
    renderShell()
    expect(document.title).toBe('Dashboard - Wicker Money')
    await userEvent.click(screen.getByRole('link', { name: 'Accounts' }))
    expect(document.title).toBe('Accounts - Wicker Money')
  })

  it('does not move focus on the first render', () => {
    renderShell()
    expect(document.activeElement).toBe(document.body)
  })

  it('moves focus to the page after navigating', async () => {
    renderShell()
    await userEvent.click(screen.getByRole('link', { name: 'Accounts' }))
    expect(document.activeElement).toBe(main())
  })

  it('has a skip link that is first in the tab order and focuses the page', async () => {
    renderShell()
    await userEvent.tab()
    const skip = screen.getByRole('link', { name: 'Skip to content' })
    expect(document.activeElement).toBe(skip)
    await userEvent.keyboard('{Enter}')
    expect(document.activeElement).toBe(main())
  })

  it('waits for the phone drawer to close before moving focus to the page', async () => {
    renderShell()
    await userEvent.click(menuButton())
    await userEvent.click(screen.getByRole('link', { name: 'Accounts' }))
    expect(menuButton().getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(main())
  })

  it('does not steal focus from the menu button when the drawer closes on Escape', async () => {
    renderShell()
    await userEvent.click(menuButton())
    await userEvent.keyboard('{Escape}')
    expect(document.activeElement).toBe(menuButton())
  })
})

describe('AppShell toast banner', () => {
  function Raise() {
    const toast = useToast()
    return <button type="button" onClick={() => { toast.show('Deleted.', { kind: 'success' }) }}>Raise</button>
  }
  function renderWithToasts() {
    return render(
      <MemoryRouter initialEntries={['/']}>
        <ToastProvider>
          <Routes>
            <Route element={<AppShell plugins={[]} />}>
              <Route index element={<Raise />} />
            </Route>
          </Routes>
        </ToastProvider>
      </MemoryRouter>,
    )
  }

  it('draws the stack as the first child of <main>, above the page', async () => {
    renderWithToasts()
    await userEvent.click(screen.getByRole('button', { name: 'Raise' }))
    const group = await screen.findByRole('group', { name: 'Notifications' })
    expect(main().firstElementChild).toBe(group)
    expect(main().children[1]?.contains(screen.getByRole('button', { name: 'Raise' }))).toBe(true)
  })

  it('renders no banner when nothing was raised, and works without a provider', () => {
    renderShell()
    expect(screen.queryByRole('group', { name: 'Notifications' })).toBeNull()
  })

  it('sets --wm-toast-offset-top from the measured phone bar', () => {
    const spy = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(57)
    try {
      const { container } = renderShell()
      expect((container.firstElementChild as HTMLElement).style.getPropertyValue('--wm-toast-offset-top')).toBe('57px')
    } finally { spy.mockRestore() }
  })

  it('keeps the announcer outside <main> and the header, which the drawer makes inert', async () => {
    renderWithToasts()
    await userEvent.click(screen.getByRole('button', { name: 'Menu' }))
    const announcer = document.querySelector('[role="status"][aria-live="polite"]')!
    expect(announcer.closest('main')).toBeNull()
    expect(announcer.closest('header')).toBeNull()
    expect(announcer.closest('[inert]')).toBeNull()
  })
})
