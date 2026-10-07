import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PluginManifest } from '@wickermoney/plugin-sdk'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from './api/ApiError.js'
import { AuthCtx } from './auth/authContext.js'
import type { AuthState } from './auth/AuthState.js'
import type { RegisteredPlugin } from './models/index.js'
import type { PluginRegistry } from './plugins/PluginRegistry.js'

/**
 * The shell loads and unloads plugins live: switching one off in Settings
 * removes its navigation entry, route and dashboard widget without a reload,
 * and its page's address then shows a friendly "turned off" state.
 */

const loadPluginRegistry = vi.fn<() => Promise<PluginRegistry>>()
const loadPluginModule = vi.fn(async (pluginId: string, module: string) =>
  function Fake() { return <p>{`${pluginId} ${module} content`}</p> })
vi.mock('./plugins/loader.js', () => ({ loadPluginRegistry, loadPluginModule }))

const apiGet = vi.fn<(path: string) => Promise<unknown>>()
const apiPatch = vi.fn<(path: string, body: unknown) => Promise<unknown>>()
vi.mock('./api/client.js', () => ({ api: { get: apiGet, patch: apiPatch, post: vi.fn(), put: vi.fn(), del: vi.fn() } }))

vi.mock('./onboarding/index.js', () => ({
  OnboardingProvider: ({ children }: { children: ReactNode }) => children,
  SetupWizard: () => null,
}))

const { AuthenticatedApp } = await import('./AuthenticatedApp.js')

const BUDGETS = {
  id: 'wickermoney.budgets', name: 'Budgets', version: '0.1.0', description: 'Plans.', author: 'Wicker',
  sdkVersion: 1, requiredTables: [], permissions: [], remoteEntry: '/plugins/budgets/remoteEntry.js',
  contributes: {
    pages: [{ path: 'budgets', title: 'Budgets', nav: { label: 'Budgets', section: 'main', order: 25 }, module: './BudgetsPage' }],
    widgets: [{ id: 'at-risk', slot: 'dashboard.primary', title: 'Budget breakdown', defaultSize: 'md', order: 6, module: './AtRiskWidget' }],
    endpoints: true, exporters: true,
  },
} as unknown as PluginManifest

const INSIGHTS = {
  id: 'wickermoney.insights', name: 'Insights', version: '0.1.0', description: 'Charts.', author: 'Wicker',
  sdkVersion: 1, requiredTables: [], permissions: [], remoteEntry: '/plugins/insights/remoteEntry.js',
  contributes: {
    pages: [],
    widgets: [{ id: 'trend', slot: 'dashboard.primary', title: 'Money in and out', defaultSize: 'lg', order: 10, module: './TrendWidget' }],
    endpoints: false, exporters: false,
  },
} as unknown as PluginManifest

function registered(m: PluginManifest, enabled: boolean): RegisteredPlugin {
  return {
    id: m.id, name: m.name, description: m.description, author: m.author, version: m.version,
    bundled: true, enabled, status: enabled ? 'enabled' : 'disabled', failure: null,
    contributes: { pages: m.contributes.pages.map((p) => p.title), widgets: m.contributes.widgets.map((w) => w.title), endpoints: m.contributes.endpoints },
  }
}

/** What the server says: which plugins are on, and whether the caller is an owner. */
let enabled: Set<string>
let isOwner: boolean

const serverRegistry = (): PluginRegistry => ({
  plugins: [BUDGETS, INSIGHTS].filter((m) => enabled.has(m.id)),
  failures: [],
})

const authFor = (role: 'owner' | 'member'): AuthState => ({
  user: { id: 'u1', email: `${role}@example.com`, timezone: 'UTC', role }, ready: true,
  signIn: vi.fn(), register: vi.fn(), signOut: vi.fn(), setTimezone: vi.fn(),
})

function mount(at: string) {
  render(
    <MemoryRouter initialEntries={[at]}>
      <AuthCtx.Provider value={authFor(isOwner ? 'owner' : 'member')}><AuthenticatedApp /></AuthCtx.Provider>
    </MemoryRouter>,
  )
}

const primaryNav = () => screen.getByRole('navigation', { name: 'Primary' })

beforeEach(() => {
  enabled = new Set([BUDGETS.id, INSIGHTS.id])
  isOwner = true
  loadPluginRegistry.mockReset().mockImplementation(async () => serverRegistry())
  apiGet.mockReset().mockImplementation(async (path) => {
    if (path !== '/plugins/registry') return new Promise(() => {})
    if (!isOwner) throw new ApiError('Only an owner of this Wicker Money instance can do this.', 403, 'owner_required')
    return { plugins: [BUDGETS, INSIGHTS].map((m) => registered(m, enabled.has(m.id))) }
  })
  apiPatch.mockReset().mockImplementation(async (path, body) => {
    const id = decodeURIComponent(path.replace('/plugins/', ''))
    const on = (body as { enabled: boolean }).enabled
    const previous = enabled.has(id)
    if (on) enabled.add(id); else enabled.delete(id)
    const m = [BUDGETS, INSIGHTS].find((p) => p.id === id)!
    return { plugin: registered(m, on), previous: { enabled: previous }, changed: previous !== on, changedBy: { id: 'u1', email: 'owner@example.com' }, changedAt: '2026-10-04T00:00:00.000Z' }
  })
})

afterEach(() => { vi.restoreAllMocks() })

describe('switching a plugin off from Settings', () => {
  it('removes its navigation entry and dashboard widget without a reload, and brings them back', async () => {
    mount('/')
    expect(await screen.findByText('wickermoney.budgets ./AtRiskWidget content')).toBeTruthy()
    expect(within(primaryNav()).getByRole('link', { name: 'Budgets' })).toBeTruthy()

    await userEvent.click(screen.getByRole('link', { name: 'Settings' }))
    await userEvent.click(await screen.findByRole('switch', { name: 'Enable Budgets' }))

    await waitFor(() => { expect(within(primaryNav()).queryByRole('link', { name: 'Budgets' })).toBeNull() })
    expect(apiPatch).toHaveBeenCalledWith('/plugins/wickermoney.budgets', { enabled: false })
    expect(loadPluginRegistry).toHaveBeenCalledTimes(2)

    await userEvent.click(within(primaryNav()).getByRole('link', { name: 'Dashboard' }))
    expect(await screen.findByText('wickermoney.insights ./TrendWidget content')).toBeTruthy()
    expect(screen.queryByText('Budget breakdown')).toBeNull()
    expect(screen.queryByText('wickermoney.budgets ./AtRiskWidget content')).toBeNull()

    // And on again: everything returns.
    await userEvent.click(screen.getByRole('link', { name: 'Settings' }))
    await userEvent.click(await screen.findByRole('switch', { name: 'Enable Budgets' }))
    await waitFor(() => { expect(within(primaryNav()).getByRole('link', { name: 'Budgets' })).toBeTruthy() })
    await userEvent.click(within(primaryNav()).getByRole('link', { name: 'Budgets' }))
    expect(await screen.findByText('wickermoney.budgets ./BudgetsPage content')).toBeTruthy()
  })
})

describe("a switched-off plugin's page", () => {
  it('turns into a friendly "turned off" state when the plugin goes away while it is open', async () => {
    const now = vi.spyOn(Date, 'now')
    mount('/p/wickermoney.budgets/budgets')
    expect(await screen.findByText('wickermoney.budgets ./BudgetsPage content')).toBeTruthy()

    // Another owner switches it off; this tab finds out when it regains focus.
    enabled.delete(BUDGETS.id)
    now.mockReturnValue(Date.now() + 60_000)
    act(() => { window.dispatchEvent(new Event('focus')) })

    expect(await screen.findByText('Budgets is turned off')).toBeTruthy()
    expect(screen.queryByText('wickermoney.budgets ./BudgetsPage content')).toBeNull()
    expect(screen.getByText(/Its data is kept/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Manage plugins' }).getAttribute('href')).toBe('/settings#plugins')
  })

  it('tells a member who can turn it back on, without the owner link', async () => {
    enabled.delete(BUDGETS.id)
    isOwner = false
    mount('/p/wickermoney.budgets/budgets')

    expect(await screen.findByText('This plugin is turned off')).toBeTruthy()
    expect(screen.getByText(/An owner of this Wicker Money instance can turn it back on/)).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Manage plugins' })).toBeNull()
    // The app knows from the user's role; it does not ask and get refused.
    expect(apiGet).not.toHaveBeenCalledWith('/plugins/registry')
  })

  it('says a plugin that is not registered at all is not installed', async () => {
    mount('/p/example.nothing/page')
    expect(await screen.findByText('This plugin is not installed')).toBeTruthy()
  })

  it('leaves addresses outside /p/ to the ordinary not-found page', async () => {
    mount('/nowhere')
    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeTruthy()
  })
})
