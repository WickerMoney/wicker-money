import { beforeEach, describe, expect, it, vi } from 'vitest'

const registerRemotes = vi.fn()
const init = vi.fn()
const loadRemote = vi.fn()
const apiGet = vi.fn()

vi.mock('@module-federation/runtime', () => ({ init, registerRemotes, loadRemote }))
vi.mock('../api/client.js', () => ({ api: { get: apiGet } }))

// Re-imported per test: the loader remembers which remotes it registered.
let { loadPluginRegistry, loadPluginModule } = await import('./loader.js')

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wickermoney.insights',
    name: 'Insights',
    version: '0.1.0',
    sdkVersion: 0,
    remoteEntry: '/plugins/insights/remoteEntry.js',
    requiredTables: [{ table: 'transactions', access: 'read' }],
    contributes: { widgets: [], pages: [] },
    // The API always says where a plugin runs; these tests are about in-realm ones.
    runtime: 'in-realm',
    ...overrides,
  }
}

beforeEach(async () => {
  vi.resetModules()
  ;({ loadPluginRegistry, loadPluginModule } = await import('./loader.js'))
  registerRemotes.mockReset()
  loadRemote.mockReset()
  apiGet.mockReset()
})

describe('shared dependencies', () => {
  it('declares the React versions that are actually running, not a hard-coded one', async () => {
    const React = await import('react')
    const ReactDom = await import('react-dom')
    apiGet.mockResolvedValue({ plugins: [] })

    await loadPluginRegistry()

    const shared = init.mock.calls[0]![0].shared as Record<string, { version: string; shareConfig: { singleton: boolean } }>
    expect(shared['react']!.version).toBe(React.version)
    expect(shared['react-dom']!.version).toBe(ReactDom.version)
    expect(shared['react']!.shareConfig.singleton).toBe(true)
    expect(shared['react-dom']!.shareConfig.singleton).toBe(true)
  })
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

  it('registers a remote once however often the registry is fetched', async () => {
    apiGet.mockResolvedValue({ plugins: [manifest()] })
    await loadPluginRegistry()
    // Switched off: the next fetch leaves it out.
    apiGet.mockResolvedValue({ plugins: [] })
    expect((await loadPluginRegistry()).plugins).toEqual([])
    // Switched on again: listed and returned, but not registered a second time.
    apiGet.mockResolvedValue({ plugins: [manifest()] })
    expect((await loadPluginRegistry()).plugins.map((p) => p.id)).toEqual(['wickermoney.insights'])

    expect(registerRemotes).toHaveBeenCalledTimes(1)
  })

  it('records where each plugin runs', async () => {
    apiGet.mockResolvedValue({ plugins: [manifest(), manifest({ id: 'acme.sandboxed', runtime: 'isolated' })] })
    const { runtimes } = await loadPluginRegistry()
    expect(runtimes).toEqual({ 'wickermoney.insights': 'in-realm', 'acme.sandboxed': 'isolated' })
  })

  it('never registers an isolated plugin with the page\'s federation runtime', async () => {
    apiGet.mockResolvedValue({ plugins: [manifest({ id: 'acme.sandboxed', runtime: 'isolated' })] })
    const { plugins } = await loadPluginRegistry()
    expect(plugins.map((p) => p.id)).toEqual(['acme.sandboxed'])
    expect(registerRemotes).not.toHaveBeenCalled()
  })

  it.each([undefined, 'in_realm', 'trusted', 7, null])('treats runtime %s as isolated', async (runtime) => {
    apiGet.mockResolvedValue({ plugins: [manifest({ runtime })] })
    const { runtimes } = await loadPluginRegistry()
    expect(runtimes).toEqual({ 'wickermoney.insights': 'isolated' })
    expect(registerRemotes).not.toHaveBeenCalled()
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

  it('refuses to load an isolated plugin into the page', async () => {
    apiGet.mockResolvedValue({ plugins: [manifest({ id: 'acme.sandboxed', runtime: 'isolated' })] })
    await loadPluginRegistry()
    await expect(loadPluginModule('acme.sandboxed', './Widget')).rejects.toThrow(/runs isolated/)
    expect(loadRemote).not.toHaveBeenCalled()
  })

  it('fails loudly when the remote exposes nothing under that key', async () => {
    loadRemote.mockResolvedValue(null)

    await expect(loadPluginModule('wickermoney.insights', './Missing')).rejects.toThrow(
      /exposes no module '\.\/Missing'/,
    )
  })
})
