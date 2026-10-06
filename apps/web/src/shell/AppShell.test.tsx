import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
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
