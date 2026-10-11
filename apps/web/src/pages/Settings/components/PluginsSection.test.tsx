import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PluginManifest } from '@wickermoney/plugin-sdk'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../api/ApiError.js'
import type { PluginEnabledChange, RegisteredPlugin } from '../../../models/index.js'
import { AuthCtx } from '../../../auth/authContext.js'
import { PluginRegistryCtx } from '../../../plugins/registry/pluginRegistryContext.js'
import { deferred } from '../../../testing/deferred.js'

const fetchRegisteredPlugins = vi.fn<() => Promise<RegisteredPlugin[]>>()
const setPluginEnabled = vi.fn<(id: string, enabled: boolean) => Promise<PluginEnabledChange>>()
vi.mock('../../../plugins/admin/pluginAdminApi.js', () => ({ fetchRegisteredPlugins, setPluginEnabled }))

const { PluginsSection } = await import('./PluginsSection.js')

function plugin(id: string, name: string, overrides: Partial<RegisteredPlugin> = {}): RegisteredPlugin {
  return {
    id, name, description: `${name} does things.`, author: 'Wicker', version: '0.1.0',
    bundled: true, enabled: true, status: 'enabled', failure: null,
    contributes: { pages: [name], widgets: [], endpoints: false },
    ...overrides,
  }
}

const budgets = plugin('wickermoney.budgets', 'Budgets', {
  contributes: { pages: ['Budgets'], widgets: ['Budget breakdown'], endpoints: true },
})
const forecast = plugin('wickermoney.forecast', 'Forecast', { enabled: false, status: 'disabled' })
const broken = plugin('example.broken', 'Broken', { status: 'failed', failure: 'sdkVersion: unsupported' })

const changeOf = (p: RegisteredPlugin, enabled: boolean): PluginEnabledChange => ({
  plugin: { ...p, enabled, status: enabled ? 'enabled' : 'disabled' },
  previous: { enabled: p.enabled }, changed: true,
  changedBy: { id: 'u1', email: 'owner@example.com' }, changedAt: '2026-10-04T00:00:00.000Z',
})

let refresh: ReturnType<typeof vi.fn<() => Promise<void>>>

function mount(loaded: readonly PluginManifest[] = [], role: 'owner' | 'member' = 'owner') {
  const auth = {
    user: { id: 'u1', email: `${role}@example.com`, timezone: 'UTC', role }, ready: true,
    signIn: vi.fn(), register: vi.fn(), signOut: vi.fn(), setTimezone: vi.fn(), refreshUser: vi.fn(),
  }
  render(
    <MemoryRouter>
      <AuthCtx.Provider value={auth}>
        <PluginRegistryCtx.Provider value={{ plugins: loaded, failures: [], refresh }}>
          <PluginsSection />
        </PluginRegistryCtx.Provider>
      </AuthCtx.Provider>
    </MemoryRouter>,
  )
}

const card = (name: string) => screen.getByRole('listitem', { name })
const switchOf = (name: string) => screen.getByRole<HTMLButtonElement>('switch', { name: `Enable ${name}` })

beforeEach(() => {
  fetchRegisteredPlugins.mockReset()
  setPluginEnabled.mockReset()
  refresh = vi.fn(async () => {})
})

describe('PluginsSection, for an owner', () => {
  it('lists every plugin with its version, origin, status and what it adds', async () => {
    fetchRegisteredPlugins.mockResolvedValue([forecast, budgets, broken])
    mount()

    await screen.findByText('Budgets does things.')
    // Sorted by name, not by id.
    expect(screen.getAllByRole('listitem').map((li) => li.getAttribute('aria-label'))).toEqual(['Broken', 'Budgets', 'Forecast'])
    expect(screen.getByText('2 of 3 on')).toBeTruthy()

    const b = within(card('Budgets'))
    expect(b.getByText('v0.1.0')).toBeTruthy()
    expect(b.getByText('bundled')).toBeTruthy()
    expect(b.getByText('Enabled')).toBeTruthy()
    expect(b.getByText('Adds: Budgets page · Budget breakdown widget · server API')).toBeTruthy()
    expect(switchOf('Budgets').getAttribute('aria-checked')).toBe('true')

    expect(within(card('Forecast')).getByText('Disabled')).toBeTruthy()
    expect(switchOf('Forecast').getAttribute('aria-checked')).toBe('false')

    const f = within(card('Broken'))
    expect(f.getByText('Failed to load')).toBeTruthy()
    expect(f.getByText('Could not load: sdkVersion: unsupported')).toBeTruthy()
  })

  it('flips at once, stays locked while saving and until the shell has refreshed, then settles', async () => {
    fetchRegisteredPlugins.mockResolvedValue([budgets])
    const saved = deferred<PluginEnabledChange>()
    setPluginEnabled.mockReturnValue(saved.promise)
    const refreshed = deferred<undefined>()
    refresh.mockReturnValue(refreshed.promise)
    mount()

    await userEvent.click(await screen.findByRole('switch', { name: 'Enable Budgets' }))

    expect(setPluginEnabled).toHaveBeenCalledWith('wickermoney.budgets', false)
    expect(switchOf('Budgets').getAttribute('aria-checked')).toBe('false')
    expect(switchOf('Budgets').disabled).toBe(true)
    expect(within(card('Budgets')).getByText('Saving…')).toBeTruthy()
    expect(within(card('Budgets')).getByRole('status').textContent).toBe('Saving…')

    saved.resolve(changeOf(budgets, false))
    await waitFor(() => { expect(refresh).toHaveBeenCalledTimes(1) })
    expect(switchOf('Budgets').disabled).toBe(true)

    refreshed.resolve(undefined)
    await waitFor(() => { expect(switchOf('Budgets').disabled).toBe(false) })
    expect(switchOf('Budgets').getAttribute('aria-checked')).toBe('false')
    expect(within(card('Budgets')).getByText('Disabled')).toBeTruthy()
    expect(screen.getByText('0 of 1 on')).toBeTruthy()
  })

  it('rolls back and says why when the server refuses', async () => {
    fetchRegisteredPlugins.mockResolvedValue([forecast])
    setPluginEnabled.mockRejectedValue(new ApiError('Only an owner of this Wicker Money instance can do this.', 403, 'owner_required'))
    mount()

    await userEvent.click(await screen.findByRole('switch', { name: 'Enable Forecast' }))

    expect(await within(card('Forecast')).findByRole('alert')).toBeTruthy()
    expect(within(card('Forecast')).getByRole('alert').textContent)
      .toBe('Could not turn Forecast on: Only an owner of this Wicker Money instance can do this.')
    expect(switchOf('Forecast').getAttribute('aria-checked')).toBe('false')
    expect(switchOf('Forecast').disabled).toBe(false)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('clears the error once a retry succeeds', async () => {
    fetchRegisteredPlugins.mockResolvedValue([forecast])
    setPluginEnabled.mockRejectedValueOnce(new Error('network down')).mockResolvedValueOnce(changeOf(forecast, true))
    mount()

    await userEvent.click(await screen.findByRole('switch', { name: 'Enable Forecast' }))
    await within(card('Forecast')).findByRole('alert')
    await userEvent.click(switchOf('Forecast'))

    await waitFor(() => { expect(switchOf('Forecast').getAttribute('aria-checked')).toBe('true') })
    expect(within(card('Forecast')).queryByRole('alert')).toBeNull()
  })
})

describe('PluginsSection, for an owner whose role is out of date', () => {
  it('shows the server\'s refusal instead of switches', async () => {
    fetchRegisteredPlugins.mockRejectedValue(new ApiError('Only an owner of this Wicker Money instance can do this.', 403, 'owner_required'))
    mount()
    expect((await screen.findByRole('alert')).textContent).toContain('Only an owner')
    expect(screen.queryByRole('switch')).toBeNull()
  })
})

describe('PluginsSection, for a member', () => {
  it('lists the plugins that are on, read-only, without asking the owner-only listing', async () => {
    const loaded = [{
      id: 'wickermoney.budgets', name: 'Budgets', version: '0.1.0', description: 'Plans.', author: 'Wicker',
      contributes: { pages: [{ title: 'Budgets' }], widgets: [], endpoints: true, exporters: true },
    }] as unknown as PluginManifest[]
    mount(loaded, 'member')

    expect(await screen.findByText(/Only an owner can turn plugins on or off/)).toBeTruthy()
    expect(fetchRegisteredPlugins).not.toHaveBeenCalled()
    expect(within(card('Budgets')).getByText('Enabled')).toBeTruthy()
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.queryByText('bundled')).toBeNull()
  })
})
