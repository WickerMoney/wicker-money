import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PluginManifest } from '@wickermoney/plugin-sdk'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../api/ApiError.js'
import type { PluginEnabledChange, RegisteredPlugin } from '../../../models/index.js'
import { AuthCtx } from '../../../auth/authContext.js'
import { PluginRegistryCtx } from '../../../plugins/registry/pluginRegistryContext.js'
import { renderWithToasts } from '../../../testing/renderWithToasts.js'
import { findToast, toastTexts } from '../../../testing/toastTexts.js'
import { deferred } from '../../../testing/deferred.js'

const fetchRegisteredPlugins = vi.fn<() => Promise<RegisteredPlugin[]>>()
const setPluginEnabled = vi.fn<(id: string, enabled: boolean) => Promise<PluginEnabledChange>>()
vi.mock('../../../plugins/admin/pluginAdminApi.js', () => ({ fetchRegisteredPlugins, setPluginEnabled }))

const { PluginsSection } = await import('./PluginsSection.js')

function plugin(id: string, name: string, overrides: Partial<RegisteredPlugin> = {}): RegisteredPlugin {
  return {
    id, name, description: `${name} does things.`, author: 'Wicker', version: '0.1.0',
    bundled: true, enabled: true, status: 'enabled', failure: null, origin: null, tables: [],
    contributes: { pages: [name], widgets: [], endpoints: false },
    ...overrides,
  }
}

const budgets = plugin('wickermoney.budgets', 'Budgets', {
  contributes: { pages: ['Budgets'], widgets: ['Budget breakdown'], endpoints: true },
})
const forecast = plugin('wickermoney.forecast', 'Forecast', { enabled: false, status: 'disabled' })
const acme = plugin('acme.report', 'Report', {
  bundled: false, enabled: false, status: 'disabled', author: 'Acme',
  origin: 'https://plugins.example.com', tables: ['accounts', 'transactions'],
})
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
  renderWithToasts(
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
    expect(await findToast()).toEqual(['Turned off Budgets.'])
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
    // The refusal stays beside the switch that was used; nothing is announced as done.
    expect(toastTexts()).toEqual([])
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

describe('PluginsSection, switching a plugin on that is not bundled', () => {
  const dialog = () => screen.getByRole('dialog')
  /** A browser fires `close` on a <dialog> when Escape is pressed; jsdom does not. */
  const pressEscape = () => { act(() => { dialog().dispatchEvent(new Event('close')) }) }

  it('turns a bundled plugin on at once, with no dialog', async () => {
    fetchRegisteredPlugins.mockResolvedValue([forecast])
    setPluginEnabled.mockResolvedValue(changeOf(forecast, true))
    mount()

    await userEvent.click(await screen.findByRole('switch', { name: 'Enable Forecast' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(setPluginEnabled).toHaveBeenCalledExactlyOnceWith('wickermoney.forecast', true)
  })

  it('opens a dialog for a third-party plugin and sends nothing yet', async () => {
    fetchRegisteredPlugins.mockResolvedValue([acme])
    mount()

    await userEvent.click(await screen.findByRole('switch', { name: 'Enable Report' }))

    const d = within(dialog())
    expect(screen.getByRole('dialog', { name: 'Turn on Report?' })).toBeTruthy()
    expect(setPluginEnabled).not.toHaveBeenCalled()
    expect(switchOf('Report').getAttribute('aria-checked')).toBe('false')
    expect(d.getByText('https://plugins.example.com')).toBeTruthy()
    expect(d.getByText('accounts, transactions')).toBeTruthy()
    expect(d.getByText(/sandboxed frame/)).toBeTruthy()
    expect(d.getByText(/no server-side code/)).toBeTruthy()
    expect(d.getByText(/can send them to\s+another server through those gaps/)).toBeTruthy()
    expect(d.getByRole('link', { name: /How far a plugin is trusted/ }).getAttribute('href'))
      .toBe('https://wickermoney.dev/docs/features/plugins#how-much-a-plugin-is-trusted')
    expect(d.getByRole('button', { name: 'Cancel' })).toBeTruthy()
    expect(d.getByRole('button', { name: 'Enable plugin' })).toBeTruthy()
  })

  it('is named by its title and described by its summary', async () => {
    fetchRegisteredPlugins.mockResolvedValue([acme])
    mount()

    await userEvent.click(await screen.findByRole('switch', { name: 'Enable Report' }))

    const described = screen.getByRole('dialog', { name: 'Turn on Report?' }).getAttribute('aria-describedby')
    expect(described).not.toBeNull()
    expect(document.getElementById(described!)?.textContent).toMatch(/not shipped with Wicker Money.*not been independently reviewed/)
  })

  it('does not put focus on the button that confirms', async () => {
    fetchRegisteredPlugins.mockResolvedValue([acme])
    mount()

    await userEvent.click(await screen.findByRole('switch', { name: 'Enable Report' }))

    // Native <dialog> focuses its first control, the close button, so a stray Enter cannot enable.
    expect(within(dialog()).getByRole('button', { name: 'Enable plugin' })).not.toBe(document.activeElement)
  })

  it('leaves the switch off, sends nothing and gives focus back on Cancel', async () => {
    fetchRegisteredPlugins.mockResolvedValue([acme])
    mount()
    await userEvent.click(await screen.findByRole('switch', { name: 'Enable Report' }))

    await userEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(setPluginEnabled).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
    expect(switchOf('Report').getAttribute('aria-checked')).toBe('false')
    expect(switchOf('Report').disabled).toBe(false)
    expect(within(card('Report')).getByRole('status').textContent).toBe('Off')
    expect(document.activeElement).toBe(switchOf('Report'))
  })

  it('cancels the same way on Escape and on the close button', async () => {
    fetchRegisteredPlugins.mockResolvedValue([acme])
    mount()

    await userEvent.click(await screen.findByRole('switch', { name: 'Enable Report' }))
    pressEscape()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(switchOf('Report'))

    await userEvent.click(switchOf('Report'))
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(switchOf('Report'))

    expect(setPluginEnabled).not.toHaveBeenCalled()
    expect(switchOf('Report').getAttribute('aria-checked')).toBe('false')
  })

  it('sends exactly one request on Enable, then settles and gives focus back', async () => {
    fetchRegisteredPlugins.mockResolvedValue([acme])
    const saved = deferred<PluginEnabledChange>()
    setPluginEnabled.mockReturnValue(saved.promise)
    mount()
    await userEvent.click(await screen.findByRole('switch', { name: 'Enable Report' }))

    await userEvent.click(within(dialog()).getByRole('button', { name: 'Enable plugin' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(setPluginEnabled).toHaveBeenCalledExactlyOnceWith('acme.report', true)
    expect(switchOf('Report').getAttribute('aria-checked')).toBe('true')
    expect(switchOf('Report').disabled).toBe(true)

    saved.resolve(changeOf(acme, true))
    await waitFor(() => { expect(switchOf('Report').disabled).toBe(false) })
    expect(setPluginEnabled).toHaveBeenCalledTimes(1)
    expect(switchOf('Report').getAttribute('aria-checked')).toBe('true')
    expect(document.activeElement).toBe(switchOf('Report'))
  })

  it('asks again after a refused Enable, since the switch went back off', async () => {
    fetchRegisteredPlugins.mockResolvedValue([acme])
    setPluginEnabled.mockRejectedValueOnce(new Error('network down')).mockResolvedValueOnce(changeOf(acme, true))
    mount()
    await userEvent.click(await screen.findByRole('switch', { name: 'Enable Report' }))
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Enable plugin' }))
    await within(card('Report')).findByRole('alert')

    await userEvent.click(switchOf('Report'))

    expect(screen.getByRole('dialog', { name: 'Turn on Report?' })).toBeTruthy()
    expect(setPluginEnabled).toHaveBeenCalledTimes(1)
  })

  it('says so in the dialog when the plugin would not load', async () => {
    fetchRegisteredPlugins.mockResolvedValue([{ ...acme, origin: null, tables: [], failure: 'remoteEntry origin is not in PLUGIN_REMOTE_ORIGINS' }])
    mount()

    await userEvent.click(await screen.findByRole('switch', { name: 'Enable Report' }))

    expect(within(dialog()).getByText(/Would not load now: remoteEntry origin is not in PLUGIN_REMOTE_ORIGINS/)).toBeTruthy()
    // Both the origin and the tables are unknown, and the dialog says so for each.
    expect(within(dialog()).getAllByText(/unknown, because its manifest is refused/)).toHaveLength(2)
  })

  it('turns a third-party plugin off with no dialog', async () => {
    const on = { ...acme, enabled: true, status: 'enabled' as const }
    fetchRegisteredPlugins.mockResolvedValue([on])
    setPluginEnabled.mockResolvedValue(changeOf(on, false))
    mount()

    await userEvent.click(await screen.findByRole('switch', { name: 'Enable Report' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(setPluginEnabled).toHaveBeenCalledExactlyOnceWith('acme.report', false)
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
