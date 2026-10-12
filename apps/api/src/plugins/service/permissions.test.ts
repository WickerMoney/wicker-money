import { PERMISSIONS, SDK_MAJOR_VERSION, type Permission, type PluginManifest } from '@wickermoney/plugin-sdk'
import { describe, expect, it } from 'vitest'
import { PluginService } from './PluginService.js'
import { InMemoryPluginUnitOfWork } from './testing/InMemoryPluginUnitOfWork.js'

/**
 * ADR 0005, open question 5 and the last exit criterion: every value in
 * `PERMISSIONS` is either implemented or refused when the manifest loads, and
 * a test fails when a value is added without one of the two.
 *
 * A permission a manifest can declare and the host ignores reads as a consent
 * gate and is not one. Until the host can enforce a permission, a plugin that
 * asks for it must fail to load, with a reason a person can read.
 *
 * To add a permission: add it to `PERMISSIONS`, then either implement it and
 * list it under `IMPLEMENTED` with the path of the test that proves the host
 * enforces it, or list it under `REFUSED`. The first test below fails until
 * you do.
 */

/** Permissions the host enforces, with the test that proves it. None yet. */
const IMPLEMENTED: Readonly<Partial<Record<Permission, string>>> = {}

/** Permissions the host refuses at load, until it can enforce them. */
const REFUSED: readonly Permission[] = ['network:outbound', 'schedule:daily', 'notify']

function manifestWith(permissions: readonly Permission[]): PluginManifest {
  return {
    id: 'acme.permission-probe',
    name: 'Permission probe',
    version: '1.0.0',
    description: 'test',
    author: 'test',
    sdkVersion: SDK_MAJOR_VERSION,
    requiredTables: [],
    permissions,
    remoteEntry: '/plugins/acme-permission-probe/remoteEntry.js',
    contributes: { pages: [], widgets: [], endpoints: false, exporters: false },
  } as unknown as PluginManifest
}

async function load(manifest: PluginManifest) {
  const service = new PluginService(new InMemoryPluginUnitOfWork(), { bundled: [manifest], now: () => 1 })
  await service.seedBundled()
  return { registry: await service.loadRegistry(), listed: (await service.listRegistered())[0] }
}

describe('every PERMISSIONS value is implemented or refused', () => {
  it('has a decision for each value, and no decision for a value that does not exist', () => {
    const decided = [...Object.keys(IMPLEMENTED), ...REFUSED]
    // Fails the day a value is added to PERMISSIONS (packages/plugin-sdk/src/manifest/PERMISSIONS.ts)
    // without being listed above.
    expect([...decided].sort()).toEqual([...PERMISSIONS].sort())
    expect(new Set(decided).size).toBe(decided.length)
  })

  it('a manifest that declares no permission loads (control)', async () => {
    const { registry, listed } = await load(manifestWith([]))
    expect(registry.failures).toEqual([])
    expect(registry.plugins.map((p) => p.manifest.id)).toEqual(['acme.permission-probe'])
    expect(listed?.status).toBe('enabled')
  })

  // FINDING P5-1 (owner: P6). Nothing in the host refuses these today: P2 left the refusal to the host,
  // P3 only answers a `notify` message with `not_supported`, and the 0.6.0 plan moved question 5 to P6.
  // The tests below state the required behaviour and are marked `.fails` so the suite stays green until
  // P6 lands. When P6 adds the refusal they start passing, vitest reports "expected to fail", and the
  // `.fails` has to be deleted: that is the intended hand-over. Do not delete a test to make it pass.
  describe.each(REFUSED)('%s is refused at load', (permission) => {
    it.fails('the plugin is left out of the registry, with a reason that names the permission', async () => {
      const { registry } = await load(manifestWith([permission]))
      expect(registry.plugins).toEqual([])
      expect(registry.failures).toHaveLength(1)
      expect(registry.failures[0]?.reason).toContain(permission)
    })

    it.fails('the registry lists it as failed, not enabled', async () => {
      const { listed } = await load(manifestWith([permission]))
      expect(listed?.status).toBe('failed')
      expect(listed?.failure).toContain(permission)
    })
  })

  it('a permission listed as implemented points at a test file that exists', async () => {
    const { existsSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    for (const [permission, file] of Object.entries(IMPLEMENTED)) {
      expect(existsSync(resolve(process.cwd(), file)), `${permission}: ${file}`).toBe(true)
    }
  })
})
