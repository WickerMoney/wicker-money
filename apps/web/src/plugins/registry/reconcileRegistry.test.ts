import type { PluginManifest } from '@wickermoney/plugin-sdk'
import { describe, expect, it } from 'vitest'
import { reconcileRegistry } from './reconcileRegistry.js'

function manifest(id: string, version = '1.0.0'): PluginManifest {
  return {
    id, name: id, version, description: '', author: '', sdkVersion: 1,
    requiredTables: [], permissions: [], remoteEntry: `/plugins/${id}/remoteEntry.js`,
    contributes: { pages: [], widgets: [], endpoints: false, exporters: false },
  } as PluginManifest
}

describe('reconcileRegistry', () => {
  it('takes the first registry as it is', () => {
    const next = { plugins: [manifest('a.one')], failures: [] }
    expect(reconcileRegistry(null, next)).toBe(next)
  })

  it('returns the previous registry itself when nothing changed', () => {
    const prev = { plugins: [manifest('a.one'), manifest('a.two')], failures: [] }
    const next = { plugins: [manifest('a.one'), manifest('a.two')], failures: [] }
    expect(reconcileRegistry(prev, next)).toBe(prev)
  })

  it('drops a removed plugin and keeps the survivors\' objects', () => {
    const one = manifest('a.one')
    const prev = { plugins: [one, manifest('a.two')], failures: [] }
    const result = reconcileRegistry(prev, { plugins: [manifest('a.one')], failures: [] })
    expect(result.plugins).toEqual([one])
    expect(result.plugins[0]).toBe(one)
  })

  it('takes the new object for a plugin whose manifest changed', () => {
    const prev = { plugins: [manifest('a.one')], failures: [] }
    const upgraded = manifest('a.one', '2.0.0')
    expect(reconcileRegistry(prev, { plugins: [upgraded], failures: [] }).plugins[0]).toBe(upgraded)
  })

  it('notices a change in failures alone', () => {
    const prev = { plugins: [], failures: [] }
    const next = { plugins: [], failures: [{ pluginId: 'a.one', reason: 'broken' }] }
    expect(reconcileRegistry(prev, next)).not.toBe(prev)
  })
})
