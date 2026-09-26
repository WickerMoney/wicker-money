import { beforeEach, describe, expect, it, vi } from 'vitest'

const registerRemotes = vi.fn()
const init = vi.fn()
const loadRemote = vi.fn()
const apiGet = vi.fn()

vi.mock('@module-federation/runtime', () => ({ init, registerRemotes, loadRemote }))
vi.mock('../api/client.js', () => ({ api: { get: apiGet } }))

const { loadPluginRegistry, loadPluginModule } = await import('./loader.js')

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wickermoney.insights',
    name: 'Insights',
    version: '0.1.0',
    sdkVersion: 0,
    remoteEntry: '/plugins/insights/remoteEntry.js',
    requiredTables: [{ table: 'transactions', access: 'read' }],
    contributes: { widgets: [], pages: [] },
    ...overrides,
  }
}

beforeEach(() => {
  registerRemotes.mockReset()
  loadRemote.mockReset()
  apiGet.mockReset()
})

describe('loadPluginRegistry', () => {
  it('registers the remote as an ES module', async () => {
    apiGet.mockResolvedValue({ plugins: [manifest()] })

    const { plugins, failures } = await loadPluginRegistry()

    expect(failures).toEqual([])
    expect(plugins).toHaveLength(1)
    // Regression guard. Vite emits the remote entry as an ES module; without
    // `type: 'module'` the federation runtime injects a classic <script> and
    // every widget dies at mount with "Cannot use import statement outside a
    // module" — a failure that only shows up in a browser.
    expect(registerRemotes).toHaveBeenCalledWith([
      {
        name: 'wickermoney_insights',
        entry: '/plugins/insights/remoteEntry.js',
        type: 'module',
      },
    ])
  })

  it('costs one plugin, not the dashboard, when a manifest is invalid', async () => {
    apiGet.mockResolvedValue({
      plugins: [{ id: 'broken.plugin' }, manifest()],
    })

    const { plugins, failures } = await loadPluginRegistry()

    expect(plugins.map((p) => p.id)).toEqual(['wickermoney.insights'])
    expect(failures).toHaveLength(1)
    expect(failures[0]?.pluginId).toBe('broken.plugin')
    expect(registerRemotes).toHaveBeenCalledTimes(1)
  })

  it('keeps failures reported by the server', async () => {
    apiGet.mockResolvedValue({
      plugins: [],
      failures: [{ pluginId: 'wickermoney.ghost', reason: 'manifest missing' }],
    })

    const { failures } = await loadPluginRegistry()

    expect(failures).toEqual([{ pluginId: 'wickermoney.ghost', reason: 'manifest missing' }])
  })
})

describe('loadPluginModule', () => {
  it('addresses the exposed module through the container name', async () => {
    loadRemote.mockResolvedValue({ default: 'the-component' })

    await expect(loadPluginModule('wickermoney.insights', './TrendWidget')).resolves.toBe('the-component')
    expect(loadRemote).toHaveBeenCalledWith('wickermoney_insights/TrendWidget')
  })

  it('fails loudly when the remote exposes nothing under that key', async () => {
    loadRemote.mockResolvedValue(null)

    await expect(loadPluginModule('wickermoney.insights', './Missing')).rejects.toThrow(
      /exposes no module '\.\/Missing'/,
    )
  })
})
