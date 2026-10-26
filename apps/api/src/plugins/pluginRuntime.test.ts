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
  it('keeps the listed bundled plugins in-realm and isolates the rest', () => {
    for (const m of BUNDLED_PLUGINS) {
      expect(pluginRuntimeFor(m, true), m.id).toBe(IN_REALM_PLUGIN_IDS.has(m.id) ? 'in-realm' : 'isolated')
    }
  })

  // Not derived from the set: these are the ports that have landed, and a plugin leaving the set by
  // mistake (or returning to it) should fail here.
  it('runs the ported plugins in a frame, the Forecast and Debt payoff pages included', () => {
    const byId = (id: string): PluginManifest => BUNDLED_PLUGINS.find((m) => m.id === id)!
    for (const id of [
      'wickermoney.insights', 'wickermoney.spending-trends', 'wickermoney.upcoming', 'wickermoney.forecast',
      'wickermoney.debt-payoff',
    ]) {
      expect(pluginRuntimeFor(byId(id), true), id).toBe('isolated')
    }
    expect(byId('wickermoney.forecast').contributes.pages).toHaveLength(1)
    expect(byId('wickermoney.debt-payoff').contributes.pages).toHaveLength(1)
    expect(byId('wickermoney.debt-payoff').contributes.widgets).toHaveLength(1)
  })

  it('keeps the plugins that are not ported in-realm', () => {
    const byId = (id: string): PluginManifest => BUNDLED_PLUGINS.find((m) => m.id === id)!
    for (const id of ['wickermoney.budgets', 'wickermoney.import-csv']) {
      expect(pluginRuntimeFor(byId(id), true), id).toBe('in-realm')
    }
    expect([...IN_REALM_PLUGIN_IDS].sort()).toEqual(['wickermoney.budgets', 'wickermoney.import-csv'])
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
    expect(pluginRuntimeFor(manifest('wickermoney.budgets', { isolated: true }), true)).toBe('isolated')
    expect(pluginRuntimeFor(manifest('wickermoney.budgets', { isolated: false }), true)).toBe('in-realm')
    // A ported plugin is isolated whatever its manifest says.
    expect(pluginRuntimeFor(manifest('wickermoney.insights', { isolated: false }), true)).toBe('isolated')
  })

  // The origin gate (ADR 0005 exit criterion 1): an entry the host does not serve has no in-realm path.
  describe('a remote entry', () => {
    const remote = 'https://plugins.example.com/budgets/remoteEntry.js'
    const IN_REALM_IDS = [...IN_REALM_PLUGIN_IDS]

    it.each(IN_REALM_IDS)('is isolated even for the bundled, listed in-realm plugin %s', (id) => {
      expect(pluginRuntimeFor(manifest(id, { remoteEntry: remote }), true)).toBe('isolated')
    })

    it('is isolated with the flag set to false, which is the most a manifest can ask for', () => {
      expect(pluginRuntimeFor(manifest('wickermoney.budgets', { remoteEntry: remote, isolated: false }), true)).toBe('isolated')
    })

    it('is isolated for a plugin the image did not ship', () => {
      expect(pluginRuntimeFor(manifest('acme.report', { remoteEntry: remote, isolated: false }), false)).toBe('isolated')
    })

    it.each([
      ['a protocol-relative URL', '//plugins.example.com/x.js'],
      ['a plain http URL', 'http://plugins.example.com/x.js'],
      ['a data: URL', 'data:text/javascript,1'],
      ['a bare relative path', 'plugins/budgets/remoteEntry.js'],
      ['an empty string', ''],
    ])('treats %s as not served by the host, so it is isolated', (_what, remoteEntry) => {
      // A crafted value the schema would refuse: this is what is left if one ever got past it.
      expect(pluginRuntimeFor(manifest('wickermoney.budgets', { remoteEntry }), true)).toBe('isolated')
    })

    it('does not change a same-origin entry', () => {
      expect(pluginRuntimeFor(manifest('wickermoney.budgets'), true)).toBe('in-realm')
    })
  })
})
