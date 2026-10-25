import { describe, expect, it } from 'vitest'
import { pluginRouteAccess } from '../auth/pluginRouteAccess.js'
import { BUNDLED_PLUGINS } from './bundled.js'

/**
 * Every request the "Until payday" widget makes (`plugins/upcoming`, `useUpcoming`), with the route the
 * server maps it to. In a frame the widget holds a plugin token that carries only the manifest's grants,
 * so each request must be one a token with exactly those grants may make, whichever runtime the plugin
 * is listed in.
 */
const REQUESTS = [
  '/api/v1/core/recurring-items/upcoming',
  // Only asked for when an older server sends legs without account names.
  '/api/v1/core/accounts/list',
] as const

describe('the Upcoming widget under its own grants', () => {
  const manifest = BUNDLED_PLUGINS.find((m) => m.id === 'wickermoney.upcoming')!
  const granted = new Map(manifest.requiredTables.map((g) => [g.table, g.access]))

  it.each(REQUESTS)('is allowed to GET %s', (path) => {
    const access = pluginRouteAccess('GET', path)
    expect(access.kind).toBe('core')
    if (access.kind !== 'core') return
    for (const need of access.needs) {
      // A read need is met by a read or a write grant.
      expect(granted.has(need.table), `${path} needs ${need.table}`).toBe(true)
      if (need.access === 'write') expect(granted.get(need.table)).toBe('write')
    }
  })

  it('holds read grants only, so nothing the widget could be made to send writes', () => {
    expect([...granted.values()].every((a) => a === 'read')).toBe(true)
    expect([...granted.keys()].sort()).toEqual(['accounts', 'recurring_items'])
  })
})
