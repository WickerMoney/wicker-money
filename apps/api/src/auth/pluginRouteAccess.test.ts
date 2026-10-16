import { describe, expect, it } from 'vitest'
import { buildApp } from '../app.js'
import { loadConfig } from '../config.js'
import type { Db } from '../db/client.js'
import { BUNDLED_PLUGINS } from '../plugins/bundled.js'
import { enumerateRoutes, type RouteKey } from '../testing/enumerateRoutes.js'
import {
  PLUGIN_ROUTE_ACCESS,
  explicitRouteAccess,
  pluginNamespaceOf,
  pluginRouteAccess,
} from './pluginRouteAccess.js'

/**
 * The route table is walked here, with no database: every `/api/v1` route must
 * be classified for plugin tokens (accessible with a grant mapping, or denied),
 * so a route someone adds tomorrow is denied until they decide otherwise.
 */

const config = loadConfig({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://unused@localhost:5432/unused',
  AUTH_SECRET: 'test-secret-that-is-comfortably-long-enough-32',
  LOG_LEVEL: 'silent',
} as NodeJS.ProcessEnv)

/** Routes outside `/api/v1`, which plugin tokens never reach. */
const OUTSIDE_API: readonly string[] = ['GET /healthz', 'GET /readyz']

const key = (r: RouteKey): string => `${r.method} ${r.path}`
const inApi = (r: RouteKey): boolean => r.path.startsWith('/api/v1/')
const namespaced = (r: RouteKey): boolean => pluginNamespaceOf(r.path) !== undefined

/** The `/api/v1` routes that are neither classified in the table nor inside a plugin namespace. */
function unclassified(routes: readonly RouteKey[]): string[] {
  return routes
    .filter((r) => inApi(r) && !namespaced(r) && explicitRouteAccess(r.method, r.path) === undefined)
    .map(key)
}

async function registeredRoutes(extra?: (app: ReturnType<typeof buildApp>) => void): Promise<RouteKey[]> {
  const app = buildApp({ db: {} as Db, config })
  extra?.(app)
  await app.ready()
  const routes = enumerateRoutes(app.printRoutes({ commonPrefix: false, includeHooks: false }))
  await app.close()
  return routes
}

describe('plugin route classification', () => {
  it('classifies every registered /api/v1 route, or puts it inside a plugin namespace', async () => {
    const routes = await registeredRoutes()
    expect(routes.filter(inApi).length).toBeGreaterThan(80)
    // A route listed here has no entry in PLUGIN_ROUTE_ACCESS (auth/pluginRouteAccess.ts).
    // Add one: `DENIED`, or `needs([table, access], ...)` if plugins should reach it.
    expect(unclassified(routes)).toEqual([])
  })

  it('fails when a new route is not classified, and the new route is denied meanwhile', async () => {
    const routes = await registeredRoutes((app) => {
      app.get('/api/v1/brand-new', () => ({}))
      app.post('/api/v1/core/brand-new-aggregate', () => ({}))
    })
    expect(unclassified(routes)).toEqual(['GET /api/v1/brand-new', 'POST /api/v1/core/brand-new-aggregate'])
    expect(pluginRouteAccess('GET', '/api/v1/brand-new')).toEqual({ kind: 'denied' })
    expect(pluginRouteAccess('POST', '/api/v1/core/brand-new-aggregate')).toEqual({ kind: 'denied' })
  })

  it('has no entry for a route that no longer exists', async () => {
    const live = new Set((await registeredRoutes()).map(key))
    expect(Object.keys(PLUGIN_ROUTE_ACCESS).filter((k) => !live.has(k))).toEqual([])
  })

  it('serves nothing outside /api/v1 except the health checks, which take no token', async () => {
    const outside = (await registeredRoutes()).filter((r) => !inApi(r)).map(key)
    expect(outside.sort()).toEqual([...OUTSIDE_API].sort())
  })

  it('only mounts plugin namespaces for bundled plugins that declare endpoints', async () => {
    const withEndpoints = new Set(BUNDLED_PLUGINS.filter((m) => m.contributes.endpoints).map((m) => m.id))
    const namespacedRoutes = (await registeredRoutes()).filter(namespaced)
    expect(namespacedRoutes.length).toBeGreaterThan(20)
    const ids = new Set(namespacedRoutes.map((r) => pluginNamespaceOf(r.path)))
    for (const id of ids) expect(withEndpoints.has(id ?? ''), `${id} is not a bundled plugin with endpoints`).toBe(true)
  })

  it('makes exactly the eight /core aggregate reads plugin-accessible', async () => {
    const accessible = Object.entries(PLUGIN_ROUTE_ACCESS).filter(([, v]) => v.kind !== 'denied').map(([k]) => k)
    const registeredCore = (await registeredRoutes()).filter((r) => r.path.startsWith('/api/v1/core/')).map(key)
    expect(accessible.sort()).toEqual(registeredCore.sort())
    expect(accessible).toHaveLength(8)
    for (const k of accessible) expect(k.startsWith('GET /api/v1/core/'), k).toBe(true)
  })

  it('maps every accessible route to at least one table, so none is open to every plugin', () => {
    for (const [route, rule] of Object.entries(PLUGIN_ROUTE_ACCESS)) {
      if (rule.kind === 'core') expect(rule.needs.length, route).toBeGreaterThan(0)
    }
  })

  it.each([
    'POST /api/v1/auth/refresh',
    'POST /api/v1/auth/login',
    'POST /api/v1/auth/register',
    'POST /api/v1/auth/logout',
    'POST /api/v1/auth/change-password',
    'GET /api/v1/auth/me',
    'PATCH /api/v1/auth/me',
    'GET /api/v1/settings/export',
    'POST /api/v1/settings/export-ticket',
    'GET /api/v1/settings/config',
    'GET /api/v1/plugins',
    'GET /api/v1/plugins/registry',
    'PATCH /api/v1/plugins/:pluginId',
    'POST /api/v1/plugins/:pluginId/token',
    'GET /api/v1/users',
    'PATCH /api/v1/users/:id/role',
    'GET /api/v1/transactions',
    'DELETE /api/v1/transactions/:id',
  ])('denies %s to plugin tokens', (route) => {
    const [method, pattern] = route.split(' ') as [string, string]
    expect(pluginRouteAccess(method, pattern)).toEqual({ kind: 'denied' })
  })

  it('denies every /auth, /settings, /plugins and /users route in the table', () => {
    const sensitive = Object.entries(PLUGIN_ROUTE_ACCESS).filter(([k]) =>
      /\s\/api\/v1\/(auth|settings|plugins|users)(\/|$)/.test(k),
    )
    expect(sensitive.length).toBeGreaterThan(10)
    for (const [route, rule] of sensitive) expect(rule.kind, route).toBe('denied')
  })
})

describe('pluginRouteAccess', () => {
  it('holds a HEAD request to its GET route', () => {
    expect(pluginRouteAccess('HEAD', '/api/v1/core/accounts/list')).toEqual(pluginRouteAccess('GET', '/api/v1/core/accounts/list'))
    expect(pluginRouteAccess('HEAD', '/api/v1/accounts')).toEqual({ kind: 'denied' })
  })

  it('does not let a method the table does not list ride on another method of the same path', () => {
    expect(pluginRouteAccess('POST', '/api/v1/core/accounts/list')).toEqual({ kind: 'denied' })
    expect(pluginRouteAccess('DELETE', '/api/v1/core/accounts/summary')).toEqual({ kind: 'denied' })
  })

  it('maps the recurring-items upcoming and forecast routes to both tables they read', () => {
    for (const path of ['/api/v1/core/recurring-items/upcoming', '/api/v1/core/recurring-items/forecast']) {
      expect(pluginRouteAccess('GET', path)).toEqual({
        kind: 'core',
        needs: [{ table: 'recurring_items', access: 'read' }, { table: 'accounts', access: 'read' }],
      })
    }
  })

  it('finds the plugin a namespace route belongs to', () => {
    expect(pluginRouteAccess('GET', '/api/v1/p/wickermoney.budgets/month')).toEqual({
      kind: 'plugin-namespace', pluginId: 'wickermoney.budgets',
    })
    expect(pluginRouteAccess('POST', '/api/v1/p/wickermoney.import-csv/batches/:id/revert')).toEqual({
      kind: 'plugin-namespace', pluginId: 'wickermoney.import-csv',
    })
  })

  it('does not treat a parameter, an empty segment or a bare prefix as a plugin id', () => {
    for (const pattern of ['/api/v1/p/:pluginId/month', '/api/v1/p//month', '/api/v1/p/', '/api/v1/p/*']) {
      expect(pluginNamespaceOf(pattern), pattern).toBeUndefined()
      expect(pluginRouteAccess('GET', pattern), pattern).toEqual({ kind: 'denied' })
    }
  })

  it('does not treat a lookalike prefix as a namespace', () => {
    for (const pattern of ['/api/v1/plugins/wickermoney.budgets', '/api/v1/pp/x/y', '/api/v1/p', '/api/v2/p/x/y']) {
      expect(pluginNamespaceOf(pattern), pattern).toBeUndefined()
    }
  })

  it('denies a route it has never heard of', () => {
    expect(pluginRouteAccess('GET', '/api/v1/who-knows')).toEqual({ kind: 'denied' })
    expect(pluginRouteAccess('GET', '/anything-else')).toEqual({ kind: 'denied' })
  })
})
