import { createHash } from 'node:crypto'
import { SDK_MAJOR_VERSION, type Permission, type PluginManifest } from '@wickermoney/plugin-sdk'
import { beforeEach, describe, expect, it } from 'vitest'
import { IN_REALM_PLUGIN_IDS } from '../bundled.js'
import { pluginRuntimeFor } from '../pluginRuntime.js'
import type { ExternalPlugin } from './ExternalPlugin.js'
import { PluginService } from './PluginService.js'
import { InMemoryPluginUnitOfWork } from './testing/InMemoryPluginUnitOfWork.js'

/**
 * The admission rules for a plugin the image did not ship (ADR 0005 and 0007):
 * an explicit rule with a test, not an accident of how the registry is built.
 */

const sri = (bytes: string): string => `sha384-${createHash('sha384').update(bytes).digest('base64')}`
const PIN = { 'remoteEntry.js': sri('entry'), 'assets/chunk-1a2b3c.js': sri('chunk') }
const REMOTE = 'https://plugins.example.com/acme-report/remoteEntry.js'

/** A raw manifest as it would sit in a JSON file. */
function raw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'acme.report',
    name: 'Report',
    version: '1.2.3',
    description: 'A report.',
    author: 'Acme',
    sdkVersion: SDK_MAJOR_VERSION,
    requiredTables: [{ table: 'transactions', access: 'read' }],
    permissions: [],
    remoteEntry: REMOTE,
    integrity: PIN,
    contributes: { pages: [], widgets: [{ id: 'w', slot: 'dashboard.primary', title: 'W', module: './W' }], endpoints: false, exporters: false },
    ...overrides,
  }
}

const external = (manifest: Record<string, unknown>, source = 'acme-report.json'): ExternalPlugin => ({ source, manifest })

const bundledManifest = (id: string, extra: Partial<PluginManifest> = {}): PluginManifest => ({
  id, name: id, version: '1.0.0', description: 'x', author: 'x', sdkVersion: SDK_MAJOR_VERSION,
  requiredTables: [], permissions: [], remoteEntry: `/plugins/${id.split('.').pop()}/remoteEntry.js`,
  contributes: { pages: [], widgets: [], endpoints: false, exporters: false }, ...extra,
}) as PluginManifest

let uow: InMemoryPluginUnitOfWork

function service(manifests: readonly ExternalPlugin[], options: ConstructorParameters<typeof PluginService>[1] = {}): PluginService {
  return new PluginService(uow, { bundled: [], external: manifests, remoteOrigins: ['https://plugins.example.com'], now: () => 1, ...options })
}

/** Registers, switches on and loads, the way an owner would. */
async function loadEnabled(s: PluginService, id = 'acme.report') {
  await s.seedBundled()
  await s.seedExternal()
  await s.setEnabled(id, true)
  return { registry: await s.loadRegistry(), listed: (await s.listRegistered()).find((p) => p.id === id) }
}

beforeEach(() => { uow = new InMemoryPluginUnitOfWork() })

describe('seeding third-party manifests', () => {
  it('registers them switched off and not bundled, with the version the manifest declares', async () => {
    const s = service([external(raw())])
    await s.seedBundled()
    await s.seedExternal()
    expect(uow.rows).toEqual([{ pluginId: 'acme.report', version: '1.2.3', enabled: false, bundled: false }])
    expect((await s.loadRegistry()).plugins).toEqual([])
  })

  it('does not switch a plugin on or off because of a restart', async () => {
    await loadEnabled(service([external(raw())]))
    await service([external(raw({ version: '1.3.0' }))]).seedExternal()
    expect(uow.rows[0]).toMatchObject({ enabled: true, version: '1.3.0' })
    await service([external(raw())]).setEnabled('acme.report', false)
    await service([external(raw())]).seedExternal()
    expect(uow.rows[0]?.enabled).toBe(false)
  })

  it('registers a manifest that will be refused, so an owner can see why', async () => {
    const s = service([external(raw({ integrity: undefined }))])
    await s.seedExternal()
    const [listed] = await s.listRegistered()
    expect(listed).toMatchObject({ id: 'acme.report', status: 'disabled', enabled: false, bundled: false })
    expect(listed?.failure).toContain('no integrity pin')
  })

  it('falls back to 0.0.0 for a version that is not a short string', async () => {
    await service([external(raw({ version: 12 }))]).seedExternal()
    expect(uow.rows[0]?.version).toBe('0.0.0')
  })
})

describe('what a third-party plugin that passes looks like', () => {
  it('loads once enabled, as not bundled, with its pin intact', async () => {
    const { registry, listed } = await loadEnabled(service([external(raw())]))
    expect(registry.failures).toEqual([])
    expect(registry.plugins).toHaveLength(1)
    expect(registry.plugins[0]).toMatchObject({ bundled: false, manifest: { id: 'acme.report', integrity: PIN } })
    expect(listed).toMatchObject({ status: 'enabled', bundled: false, failure: null })
  })

  it('always runs isolated, whatever the manifest says about itself', async () => {
    for (const isolated of [undefined, true, false]) {
      const { registry } = await loadEnabled(service([external(raw({ isolated }))]))
      const loaded = registry.plugins[0]!
      expect(pluginRuntimeFor(loaded.manifest, loaded.bundled)).toBe('isolated')
      uow = new InMemoryPluginUnitOfWork()
    }
  })

  it('may be served by this host when its entry is a /plugins/ path, but still needs a pin', async () => {
    const entry = '/plugins/acme-report/remoteEntry.js'
    expect((await loadEnabled(service([external(raw({ remoteEntry: entry }))], { remoteOrigins: [] }))).registry.plugins).toHaveLength(1)
    uow = new InMemoryPluginUnitOfWork()
    const { registry, listed } = await loadEnabled(service([external(raw({ remoteEntry: entry, integrity: undefined }))], { remoteOrigins: [] }))
    expect(registry.plugins).toEqual([])
    expect(listed?.failure).toContain('no integrity pin')
  })
})

describe('what an owner is shown before switching a third-party plugin on', () => {
  it('lists the origin it loads from and the tables it lists, once each and sorted', async () => {
    const tables = [{ table: 'transactions', access: 'read' }, { table: 'accounts', access: 'read' }, { table: 'transactions', access: 'write' }]
    const s = service([external(raw({ requiredTables: tables }))])
    await s.seedExternal()
    expect((await s.listRegistered())[0]).toMatchObject({ origin: 'https://plugins.example.com', tables: ['accounts', 'transactions'] })
  })

  it('has no origin for an entry served by this host', async () => {
    const s = service([external(raw({ remoteEntry: '/plugins/acme-report/remoteEntry.js' }))], { remoteOrigins: [] })
    await s.seedExternal()
    expect((await s.listRegistered())[0]).toMatchObject({ origin: null, tables: ['transactions'] })
  })

  it('has neither when the manifest is refused, since nothing is trusted from it', async () => {
    const s = service([external(raw({ remoteEntry: 'https://elsewhere.example.net/remoteEntry.js' }))])
    await s.seedExternal()
    expect((await s.listRegistered())[0]).toMatchObject({ status: 'disabled', origin: null, tables: [] })
  })
})

describe('the rule: a non-bundled manifest gets no server half', () => {
  it.each([
    ['endpoints', { endpoints: true, exporters: false }],
    ['exporters', { endpoints: false, exporters: true }],
    ['both', { endpoints: true, exporters: true }],
  ])('refuses a manifest that asks for %s, even with a perfect pin', async (_what, flags) => {
    const contributes = { pages: [], widgets: [{ id: 'w', slot: 'dashboard.primary', title: 'W', module: './W' }], ...flags }
    const { registry, listed } = await loadEnabled(service([external(raw({ contributes }))]))
    expect(registry.plugins).toEqual([])
    expect(registry.failures).toHaveLength(1)
    expect(registry.failures[0]?.reason).toContain('no server half')
    expect(listed).toMatchObject({ status: 'failed', bundled: false })
    // Nothing reports a server half for it either.
    expect(listed?.contributes.endpoints).toBe(false)
  })

  it('is not changed by a bundled plugin that has endpoints', async () => {
    const withEndpoints = bundledManifest('wickermoney.thing', { contributes: { pages: [], widgets: [], endpoints: true, exporters: true } })
    const s = new PluginService(uow, { bundled: [withEndpoints], now: () => 1 })
    await s.seedBundled()
    const registry = await s.loadRegistry()
    expect(registry.failures).toEqual([])
    expect(registry.plugins[0]).toMatchObject({ bundled: true })
  })
})

describe('the rule: nothing in the registry row can make a plugin bundled', () => {
  it('treats a row that says bundled as external when the manifest came from the directory', async () => {
    uow.rows.push({ pluginId: 'acme.report', version: '1.0.0', enabled: true, bundled: true })
    const s = service([external(raw())])
    const { plugins } = await s.loadRegistry()
    expect(plugins[0]).toMatchObject({ bundled: false })
    expect(pluginRuntimeFor(plugins[0]!.manifest, plugins[0]!.bundled)).toBe('isolated')
    expect((await s.listRegistered())[0]?.bundled).toBe(false)
  })

  it('does not let a directory manifest replace a bundled one, or run as one', async () => {
    const real = bundledManifest('wickermoney.budgets')
    const impostor = raw({ id: 'wickermoney.budgets', name: 'Impostor', remoteEntry: REMOTE })
    const s = new PluginService(uow, { bundled: [real], external: [external(impostor)], remoteOrigins: ['https://plugins.example.com'], now: () => 1 })
    await s.seedBundled()
    await s.seedExternal()
    const { plugins } = await s.loadRegistry()
    expect(plugins).toHaveLength(1)
    expect(plugins[0]?.manifest.name).toBe('wickermoney.budgets')
    expect(plugins[0]?.bundled).toBe(true)
    expect(uow.rows).toHaveLength(1)
  })

  it('keeps the first of two manifests that claim one id', async () => {
    const s = service([external(raw({ name: 'First' }), 'a.json'), external(raw({ name: 'Second' }), 'b.json')])
    const { registry } = await loadEnabled(s)
    expect(registry.plugins.map((p) => p.manifest.name)).toEqual(['First'])
  })

  it('corrects a row that was bundled once and is now external', async () => {
    uow.rows.push({ pluginId: 'acme.report', version: '0.1.0', enabled: true, bundled: true })
    await service([external(raw())]).seedExternal()
    expect(uow.rows[0]).toMatchObject({ bundled: false, enabled: true, version: '1.2.3' })
  })

  it('reports a stale row (neither bundled nor in the directory) as failed', async () => {
    uow.rows.push({ pluginId: 'acme.gone', version: '1.0.0', enabled: true, bundled: false })
    const s = service([])
    expect((await s.loadRegistry()).failures).toEqual([{ pluginId: 'acme.gone', reason: 'no manifest found for this plugin id' }])
    expect((await s.listRegistered())[0]).toMatchObject({ status: 'failed', bundled: false })
  })
})

describe('the rule: a plugin the image did not ship loads only against a pin', () => {
  it('refuses a manifest with no pin and says how to add one', async () => {
    const { registry, listed } = await loadEnabled(service([external(raw({ integrity: undefined }))]))
    expect(registry.plugins).toEqual([])
    expect(listed?.failure).toMatch(/no integrity pin.*sha384/)
  })

  it('refuses a pin that leaves the entry file out', async () => {
    const { registry } = await loadEnabled(service([external(raw({ integrity: { 'assets/chunk-1a2b3c.js': PIN['assets/chunk-1a2b3c.js'] } }))]))
    expect(registry.failures[0]?.reason).toContain("does not list the entry file 'remoteEntry.js'")
  })

  it('refuses a pin with a malformed value through the manifest schema', async () => {
    const { registry } = await loadEnabled(service([external(raw({ integrity: { 'remoteEntry.js': 'sha384-not-a-hash' } }))]))
    expect(registry.failures[0]?.reason).toContain('integrity')
  })

  it('checks the origin before the pin: an unlisted origin is refused for that reason', async () => {
    const { registry } = await loadEnabled(service([external(raw())], { remoteOrigins: [] }))
    expect(registry.failures[0]?.reason).toContain('PLUGIN_REMOTE_ORIGINS')
  })

  it('refuses a bundled manifest whose entry is on another origin and unpinned, and loads it pinned (isolated)', async () => {
    const crafted = bundledManifest('wickermoney.budgets', { remoteEntry: REMOTE })
    const run = async (m: PluginManifest) => {
      uow = new InMemoryPluginUnitOfWork()
      const s = new PluginService(uow, { bundled: [m], remoteOrigins: ['https://plugins.example.com'], now: () => 1 })
      await s.seedBundled()
      return s.loadRegistry()
    }
    const unpinned = await run(crafted)
    expect(unpinned.plugins).toEqual([])
    expect(unpinned.failures[0]?.reason).toContain('no integrity pin')

    const pinned = await run({ ...crafted, integrity: PIN } as PluginManifest)
    expect(pinned.plugins).toHaveLength(1)
    const loaded = pinned.plugins[0]!
    expect(IN_REALM_PLUGIN_IDS.has(loaded.manifest.id)).toBe(true)
    expect(pluginRuntimeFor(loaded.manifest, loaded.bundled)).toBe('isolated')
  })

  it('does not ask a bundled plugin served from the image for a pin', async () => {
    const s = new PluginService(uow, { bundled: [bundledManifest('wickermoney.budgets')], now: () => 1 })
    await s.seedBundled()
    expect((await s.loadRegistry()).plugins).toHaveLength(1)
  })
})

describe('the permission refusal applies to a third-party manifest too', () => {
  it.each<Permission>(['network:outbound', 'schedule:daily', 'notify'])('%s', async (permission) => {
    const { registry, listed } = await loadEnabled(service([external(raw({ permissions: [permission] }))]))
    expect(registry.plugins).toEqual([])
    expect(listed?.failure).toContain(permission)
  })
})

describe('a third-party manifest is untrusted input', () => {
  it.each([
    ['not an object', 'nope'],
    ['missing fields', { id: 'acme.report' }],
    ['a newer SDK than the host', raw({ sdkVersion: SDK_MAJOR_VERSION + 1 })],
    ['a table that is not a core table', raw({ requiredTables: [{ table: 'users', access: 'read' }] })],
    ['a remoteEntry with credentials', raw({ remoteEntry: 'https://user:pw@plugins.example.com/acme/remoteEntry.js' })],
    ['a remoteEntry that is a javascript: URL', raw({ remoteEntry: 'javascript:alert(1)' })],
    ['a remoteEntry with a query string', raw({ remoteEntry: `${REMOTE}?v=2` })],
  ])('never loads one with %s', async (_what, manifest) => {
    // `seedExternal` reads the id off the raw value, so give it one the way the directory reader would.
    const withId = typeof manifest === 'object' ? manifest : { id: 'acme.report' }
    const { registry } = await loadEnabled(service([external(withId as Record<string, unknown>)]))
    expect(registry.plugins).toEqual([])
    expect(registry.failures).toHaveLength(1)
  })
})
