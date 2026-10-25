import { render, screen, waitFor } from '@testing-library/react'
import type { PluginContext, PluginManifest } from '@wickermoney/plugin-sdk'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { MountedPage } from './MountedPage.js'
import { MountedWidget } from './MountedWidget.js'
import { PluginRegistryCtx } from './registry/pluginRegistryContext.js'
import type { PluginRegistryState } from './registry/PluginRegistryState.js'

vi.mock('./loader.js', () => ({ loadPluginModule: vi.fn(async () => () => <p>in the page</p>) }))

const manifest = {
  id: 'test.fixture', name: 'Fixture', version: '0.1.0', description: '', author: '', sdkVersion: 0, permissions: [],
  remoteEntry: '/plugins/test.fixture/remoteEntry.js', requiredTables: [], contributes: { widgets: [], pages: [] },
} as unknown as PluginManifest
const ctx = { session: { userId: 'u', email: 'e', timezone: 'UTC' }, navigate: vi.fn() } as unknown as PluginContext
const contribution = { id: 'w', title: 'Spending', slot: 'dashboard.primary', module: './W', defaultSize: 'md', order: 1 } as never

const BASE = '/p/test.fixture/report'

/** A page the way `pluginRoutes` mounts it: on `<base>/*`, at the given address. */
const pageAt = (address: string) => (
  <MemoryRouter initialEntries={[address]}>
    <Routes>
      <Route path={`${BASE}/*`} element={<MountedPage manifest={manifest} module="./P" title="Report" ctx={ctx} basePath={BASE} />} />
    </Routes>
  </MemoryRouter>
)

const withRegistry = (state: Partial<PluginRegistryState> | null, ui: React.ReactNode) => (
  <PluginRegistryCtx.Provider value={state === null ? null : { plugins: [], failures: [], refresh: async () => {}, ...state }}>
    {ui}
  </PluginRegistryCtx.Provider>
)

describe('choosing where a plugin runs', () => {
  it('mounts an in-realm widget in the page', async () => {
    const { container } = render(withRegistry(
      { runtimes: { 'test.fixture': 'in-realm' } },
      <MountedWidget manifest={manifest} contribution={contribution} ctx={ctx} />,
    ))
    expect(await screen.findByText('in the page')).toBeTruthy()
    expect(container.querySelector('iframe')).toBeNull()
  })

  it('mounts an isolated widget in a sandboxed frame inside the same card', () => {
    const { container } = render(withRegistry(
      { runtimes: { 'test.fixture': 'isolated' } },
      <MountedWidget manifest={manifest} contribution={contribution} ctx={ctx} />,
    ))
    expect(container.querySelector('.slot-item--md .wm-surface iframe')?.getAttribute('sandbox')).toBe('allow-scripts')
    expect(screen.queryByText('in the page')).toBeNull()
  })

  it('mounts an isolated page in a frame', () => {
    const { container } = render(withRegistry({ runtimes: { 'test.fixture': 'isolated' } }, pageAt(BASE)))
    expect(container.querySelector('iframe')?.title).toBe('Fixture · Report')
  })

  it('mounts an isolated page for any address under it, as one page', () => {
    const { container } = render(withRegistry({ runtimes: { 'test.fixture': 'isolated' } }, pageAt(`${BASE}/2026/10?tab=2`)))
    expect(container.querySelectorAll('iframe')).toHaveLength(1)
  })

  it('answers "not found" to an address under an in-realm page, which has no use for one', () => {
    const { container } = render(withRegistry({ runtimes: { 'test.fixture': 'in-realm' } }, pageAt(`${BASE}/2026/10`)))
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeTruthy()
    expect(container.querySelector('iframe')).toBeNull()
  })

  it('puts a plugin the loaded registry does not mention in the sandbox', () => {
    const { container } = render(withRegistry(
      { runtimes: {} },
      <MountedWidget manifest={manifest} contribution={contribution} ctx={ctx} />,
    ))
    expect(container.querySelector('iframe')).not.toBeNull()
  })

  it('keeps the legacy in-page path without a registry or runtime map', async () => {
    render(withRegistry(null, <MountedWidget manifest={manifest} contribution={contribution} ctx={ctx} />))
    expect(await screen.findByText('in the page')).toBeTruthy()
    render(withRegistry({}, pageAt(BASE)))
    await waitFor(() => { expect(screen.getAllByText('in the page')).toHaveLength(2) })
  })
})
