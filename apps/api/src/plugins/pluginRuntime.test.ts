import { describe, expect, it } from 'vitest'
import { SDK_MAJOR_VERSION, type PluginManifest } from '@wickermoney/plugin-sdk'
import { BUNDLED_PLUGINS, IN_REALM_PLUGIN_IDS } from './bundled.js'
import { pluginRuntimeFor } from './pluginRuntime.js'

function manifest(id: string, extra: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id, name: 'Test', version: '1.0.0', description: 'x', author: 'x', sdkVersion: SDK_MAJOR_VERSION,
    requiredTables: [], permissions: [], remoteEntry: `/plugins/${id}/remoteEntry.js`,
    contributes: { pages: [], widgets: [], endpoints: false, exporters: false }, ...extra,
  } as PluginManifest
}

describe('pluginRuntimeFor', () => {
  it('keeps the listed bundled plugins in-realm in 0.6.0', () => {
    for (const m of BUNDLED_PLUGINS) {
      expect(pluginRuntimeFor(m, true), m.id).toBe('in-realm')
    }
  })

  it('lists only plugins that are actually bundled', () => {
    const bundled = new Set(BUNDLED_PLUGINS.map((m) => m.id))
    for (const id of IN_REALM_PLUGIN_IDS) expect(bundled.has(id), id).toBe(true)
  })

  it('isolates every plugin the image did not ship, whatever its id', () => {
    expect(pluginRuntimeFor(manifest('acme.thing'), false)).toBe('isolated')
    // Same id as a listed bundled plugin: the registry row says it is not bundled.
    expect(pluginRuntimeFor(manifest('wickermoney.budgets'), false)).toBe('isolated')
    expect(pluginRuntimeFor(manifest('wickermoney.budgets', { isolated: false }), false)).toBe('isolated')
  })

  it('isolates a bundled plugin that is not listed', () => {
    expect(pluginRuntimeFor(manifest('wickermoney.new-thing'), true)).toBe('isolated')
  })

  it('lets the isolated flag move a listed plugin towards isolation, never away', () => {
    expect(pluginRuntimeFor(manifest('wickermoney.insights', { isolated: true }), true)).toBe('isolated')
    expect(pluginRuntimeFor(manifest('wickermoney.insights', { isolated: false }), true)).toBe('in-realm')
  })
})
