import { render, screen, waitFor } from '@testing-library/react'
import type { PluginContext, PluginManifest } from '@wickermoney/plugin-sdk'
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
    const { container } = render(withRegistry(
      { runtimes: { 'test.fixture': 'isolated' } },
      <MountedPage manifest={manifest} module="./P" title="Report" ctx={ctx} />,
    ))
    expect(container.querySelector('iframe')?.title).toBe('Fixture · Report')
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
    render(withRegistry({}, <MountedPage manifest={manifest} module="./P" title="Report" ctx={ctx} />))
    await waitFor(() => { expect(screen.getAllByText('in the page')).toHaveLength(2) })
  })
})
