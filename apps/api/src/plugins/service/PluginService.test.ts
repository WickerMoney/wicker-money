import type { PluginManifest } from '@wickermoney/plugin-sdk'
import { SDK_MAJOR_VERSION } from '@wickermoney/plugin-sdk'
import { beforeEach, describe, expect, it } from 'vitest'
import { PluginService } from './PluginService.js'
import { InMemoryPluginUnitOfWork } from './testing/InMemoryPluginUnitOfWork.js'

function manifest(id: string, remoteEntry = `/plugins/${id}/remoteEntry.js`, version = '1.0.0'): PluginManifest {
  return {
    id: `wickermoney.${id}`,
    name: id,
    version,
    description: 'test',
    author: 'test',
    sdkVersion: SDK_MAJOR_VERSION,
    requiredTables: [],
    permissions: [],
    remoteEntry,
    contributes: { pages: [], widgets: [], endpoints: false, exporters: false },
  }
}

const alpha = manifest('alpha')
const beta = manifest('beta')

let uow: InMemoryPluginUnitOfWork
let clock: number

function service(options: ConstructorParameters<typeof PluginService>[1] = {}): PluginService {
  return new PluginService(uow, { bundled: [alpha, beta], now: () => clock, ...options })
}

beforeEach(() => {
  uow = new InMemoryPluginUnitOfWork()
  clock = 1_000_000
})

describe('seeding', () => {
  it('registers every bundled plugin as enabled', async () => {
    await service().seedBundled()
    expect(uow.rows.map((r) => [r.pluginId, r.enabled, r.bundled])).toEqual([
      ['wickermoney.alpha', true, true],
      ['wickermoney.beta', true, true],
    ])
  })

  it('keeps a plugin the user disabled disabled, and refreshes its version', async () => {
    const s = service()
    await s.seedBundled()
    await s.setEnabled('wickermoney.alpha', false)
    await service({ bundled: [manifest('alpha', undefined, '2.0.0'), beta] }).seedBundled()
    expect(uow.rows.find((r) => r.pluginId === 'wickermoney.alpha')).toMatchObject({ enabled: false, version: '2.0.0' })
  })
})

describe('loading the registry', () => {
  it('returns enabled plugins with valid manifests', async () => {
    const s = service()
    await s.seedBundled()
    const { plugins, failures } = await s.loadRegistry()
    expect(plugins.map((p) => p.manifest.id)).toEqual(['wickermoney.alpha', 'wickermoney.beta'])
    expect(plugins.every((p) => p.bundled)).toBe(true)
    expect(failures).toEqual([])
  })

  it('reports a stale row rather than failing the whole registry', async () => {
    uow.rows.push({ pluginId: 'ghost.plugin', version: '1', enabled: true, bundled: false })
    const { plugins, failures } = await service().loadRegistry()
    expect(plugins).toEqual([])
    expect(failures).toEqual([{ pluginId: 'ghost.plugin', reason: 'no manifest found for this plugin id' }])
  })

  it('reports an invalid manifest for that plugin alone', async () => {
    const broken = { ...beta, id: 'not-reverse-domain' }
    const s = service({ bundled: [alpha, broken] })
    await s.seedBundled()
    const { plugins, failures } = await s.loadRegistry()
    expect(plugins.map((p) => p.manifest.id)).toEqual(['wickermoney.alpha'])
    expect(failures).toHaveLength(1)
    expect(failures[0]?.reason).toContain('reverse-domain')
  })
})

describe('remote entry origins', () => {
  const remote = manifest('remote', 'https://plugins.example.com/remote/remoteEntry.js')

  it('refuses a remote origin when none is allowed (same-origin only by default)', async () => {
    const s = service({ bundled: [alpha, remote] })
    await s.seedBundled()
    const { plugins, failures } = await s.loadRegistry()
    expect(plugins.map((p) => p.manifest.id)).toEqual(['wickermoney.alpha'])
    expect(failures[0]).toMatchObject({ pluginId: 'wickermoney.remote' })
    expect(failures[0]?.reason).toContain('PLUGIN_REMOTE_ORIGINS')
  })

  it('accepts a remote origin that is on the allowlist', async () => {
    const s = service({ bundled: [alpha, remote], remoteOrigins: ['https://plugins.example.com'] })
    await s.seedBundled()
    const { plugins, failures } = await s.loadRegistry()
    expect(plugins.map((p) => p.manifest.id)).toEqual(['wickermoney.alpha', 'wickermoney.remote'])
    expect(failures).toEqual([])
  })

  it('refuses a different origin than the one allowed', async () => {
    const s = service({ bundled: [remote], remoteOrigins: ['https://other.example.com'] })
    await s.seedBundled()
    expect((await s.loadRegistry()).plugins).toEqual([])
  })
})

describe('registry cache', () => {
  it('reads the database once within the TTL', async () => {
    const s = service({ cacheTtlMs: 5_000 })
    await s.seedBundled()
    await s.loadRegistry()
    await s.loadRegistry()
    await s.findEnabled('wickermoney.alpha')
    expect(uow.listCalls).toBe(1)
  })

  it('reads again once the TTL has passed', async () => {
    const s = service({ cacheTtlMs: 5_000 })
    await s.seedBundled()
    await s.loadRegistry()
    clock += 4_999
    await s.loadRegistry()
    expect(uow.listCalls).toBe(1)
    clock += 1
    await s.loadRegistry()
    expect(uow.listCalls).toBe(2)
  })

  it('does not cache when the TTL is zero', async () => {
    const s = service({ cacheTtlMs: 0 })
    await s.seedBundled()
    await s.loadRegistry()
    await s.loadRegistry()
    expect(uow.listCalls).toBe(2)
  })

  it('shares one read between concurrent callers', async () => {
    const s = service()
    await s.seedBundled()
    await Promise.all([s.loadRegistry(), s.loadRegistry(), s.loadRegistry()])
    expect(uow.listCalls).toBe(1)
  })

  it('takes effect on the next request after a toggle through the service', async () => {
    const s = service()
    await s.seedBundled()
    expect(await s.findEnabled('wickermoney.alpha')).toBeDefined()

    await s.setEnabled('wickermoney.alpha', false)
    expect(await s.findEnabled('wickermoney.alpha')).toBeUndefined()

    await s.setEnabled('wickermoney.alpha', true)
    expect(await s.findEnabled('wickermoney.alpha')).toBeDefined()
  })

  it('serves a stale answer for an out-of-band change until cleared, then the fresh one', async () => {
    const s = service()
    await s.seedBundled()
    await s.loadRegistry()

    const row = uow.rows.find((r) => r.pluginId === 'wickermoney.alpha')
    if (row !== undefined) row.enabled = false
    expect(await s.findEnabled('wickermoney.alpha')).toBeDefined()

    s.clearCache()
    expect(await s.findEnabled('wickermoney.alpha')).toBeUndefined()
  })

  it('reports whether the toggled plugin exists', async () => {
    const s = service()
    await s.seedBundled()
    expect(await s.setEnabled('wickermoney.alpha', false)).toBe(true)
    expect(await s.setEnabled('nobody.home', false)).toBe(false)
  })
})

describe('listing every registered plugin', () => {
  it('includes disabled plugins and reports each one\'s status', async () => {
    const s = service()
    await s.seedBundled()
    await s.setEnabled('wickermoney.beta', false)
    const list = await s.listRegistered()
    expect(list.map((p) => [p.id, p.enabled, p.status, p.failure])).toEqual([
      ['wickermoney.alpha', true, 'enabled', null],
      ['wickermoney.beta', false, 'disabled', null],
    ])
    expect(list[0]).toMatchObject({ name: 'alpha', version: '1.0.0', bundled: true, description: 'test' })
  })

  it('marks an enabled plugin that cannot load as failed, with the reason', async () => {
    const broken = { ...beta, id: 'not-reverse-domain' }
    const s = service({ bundled: [alpha, broken] })
    await s.seedBundled()
    const failed = (await s.listRegistered()).find((p) => p.id === 'not-reverse-domain')
    expect(failed).toMatchObject({ status: 'failed', enabled: true, name: 'beta' })
    expect(failed?.failure).toContain('reverse-domain')
  })

  it('still reports the reason for a disabled plugin that would fail', async () => {
    const remote = manifest('remote', 'https://plugins.example.com/remoteEntry.js')
    const s = service({ bundled: [remote] })
    await s.seedBundled()
    await s.setEnabled('wickermoney.remote', false)
    const [only] = await s.listRegistered()
    expect(only).toMatchObject({ status: 'disabled' })
    expect(only?.failure).toContain('PLUGIN_REMOTE_ORIGINS')
  })

  it('falls back to the stored id and version for a row with no manifest', async () => {
    uow.rows.push({ pluginId: 'ghost.plugin', version: '0.9.0', enabled: false, bundled: false })
    const ghost = (await service().listRegistered()).find((p) => p.id === 'ghost.plugin')
    expect(ghost).toMatchObject({
      name: 'ghost.plugin', version: '0.9.0', description: null, status: 'disabled',
      failure: 'no manifest found for this plugin id',
      contributes: { pages: [], widgets: [], endpoints: false },
    })
  })
})

describe('changing whether a plugin is enabled', () => {
  it('reports the previous state and the plugin as it now is', async () => {
    const s = service()
    await s.seedBundled()
    const change = await s.changeEnabled('wickermoney.alpha', false)
    expect(change).toMatchObject({ previous: true, plugin: { id: 'wickermoney.alpha', enabled: false, status: 'disabled' } })
    expect(await s.findEnabled('wickermoney.alpha')).toBeUndefined()
  })

  it('is idempotent', async () => {
    const s = service()
    await s.seedBundled()
    await s.changeEnabled('wickermoney.alpha', false)
    expect(await s.changeEnabled('wickermoney.alpha', false)).toMatchObject({ previous: false, plugin: { enabled: false } })
  })

  it('answers undefined for an id that is not registered', async () => {
    const s = service()
    await s.seedBundled()
    expect(await s.changeEnabled('nobody.home', true)).toBeUndefined()
  })
})
