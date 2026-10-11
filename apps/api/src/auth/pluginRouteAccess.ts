import type { CoreTableName } from '@wickermoney/plugin-sdk'
import type { PluginGrantAccess } from './pluginTokens.js'

/**
 * @module
 * Which `/api/v1` routes a plugin token may reach.
 *
 * **Default deny.** A plugin token can reach exactly two kinds of route:
 *
 *  - a `/api/v1/core/*` route listed below as plugin-accessible, and only when
 *    the token grants every table the route is mapped to, at the level given;
 *  - any route inside the plugin's own namespace, `/api/v1/p/<its id>/*`.
 *
 * Every other route is denied: authentication, the data export, instance
 * settings, plugin management, owner-only administration, the user-facing
 * data routes, and every other plugin's namespace. A route that is not in the
 * table is denied too, so a new route is closed to plugins until someone
 * decides otherwise here. `pluginRouteAccess.test.ts` fails when a registered
 * route is not listed, which makes that decision a deliberate edit to this
 * file rather than an accident.
 *
 * Classification is by the route's registered pattern (`/api/v1/accounts/:id`),
 * never by the URL a request used, so path tricks cannot change the answer.
 * The request middleware that applies it is in `plugin.ts`.
 */

/** A table a route needs and the access level it needs on it. */
export interface RouteTableNeed {
  readonly table: CoreTableName
  readonly access: PluginGrantAccess
}

/** What a plugin token may do with one route. */
export type PluginRouteAccess =
  /** Plugin tokens are refused. */
  | { readonly kind: 'denied' }
  /** Allowed when the token grants every listed table at the listed level. */
  | { readonly kind: 'core'; readonly needs: readonly RouteTableNeed[] }
  /** Allowed only for the plugin whose namespace this is. */
  | { readonly kind: 'plugin-namespace'; readonly pluginId: string }

/** The prefix of every plugin's own routes. */
export const PLUGIN_NAMESPACE_PREFIX = '/api/v1/p/'

const DENIED: PluginRouteAccess = { kind: 'denied' }

/** Classification entry for a core route: allowed with these table needs. */
const needs = (...list: ReadonlyArray<readonly [CoreTableName, PluginGrantAccess]>): PluginRouteAccess => ({
  kind: 'core',
  needs: list.map(([table, access]) => ({ table, access })),
})

/**
 * The classification of every `/api/v1` route outside a plugin namespace, by
 * `METHOD pattern`. `HEAD` is classified as its `GET`.
 *
 * Keep it complete: the test walks the registered routes and fails on any that
 * is missing here, and on any entry here that no longer exists.
 */
export const PLUGIN_ROUTE_ACCESS: Readonly<Record<string, PluginRouteAccess>> = {
  // The surface plugins are meant to use: aggregate reads behind a table grant.
  // The mapping must match the guards the handlers run; the integration test
  // checks it by calling each route with every table left out in turn.
  'GET /api/v1/core/transactions/monthly-summary': needs(['transactions', 'read']),
  'GET /api/v1/core/accounts/list': needs(['accounts', 'read']),
  'GET /api/v1/core/accounts/summary': needs(['accounts', 'read']),
  'GET /api/v1/core/categories/list': needs(['categories', 'read']),
  'GET /api/v1/core/recurring-items/list': needs(['recurring_items', 'read']),
  'GET /api/v1/core/recurring-items/occurrences': needs(['recurring_items', 'read']),
  'GET /api/v1/core/recurring-items/upcoming': needs(['recurring_items', 'read'], ['accounts', 'read']),
  'GET /api/v1/core/recurring-items/forecast': needs(['recurring_items', 'read'], ['accounts', 'read']),

  // Authentication: a plugin never signs in, refreshes, registers or changes credentials.
  'POST /api/v1/auth/register': DENIED,
  'POST /api/v1/auth/login': DENIED,
  'POST /api/v1/auth/refresh': DENIED,
  'POST /api/v1/auth/logout': DENIED,
  'POST /api/v1/auth/change-password': DENIED,
  'GET /api/v1/auth/me': DENIED,
  'PATCH /api/v1/auth/me': DENIED,

  // Instance settings, the full data export and the erase actions.
  'GET /api/v1/settings/config': DENIED,
  'GET /api/v1/settings/export': DENIED,
  'POST /api/v1/settings/erase-my-data': DENIED,
  'GET /api/v1/settings/erase-instance': DENIED,
  'POST /api/v1/settings/erase-instance': DENIED,

  // Plugin management, including minting tokens: a plugin cannot mint, widen or renew its own.
  'GET /api/v1/plugins': DENIED,
  'GET /api/v1/plugins/registry': DENIED,
  'PATCH /api/v1/plugins/:pluginId': DENIED,
  'POST /api/v1/plugins/:pluginId/token': DENIED,

  // Owner-only account administration.
  'GET /api/v1/users': DENIED,
  'PATCH /api/v1/users/:id/role': DENIED,

  // The host's own screens read and write the user's data through these. A
  // plugin gets the narrower `/core/*` aggregates above instead.
  'GET /api/v1/accounts': DENIED,
  'POST /api/v1/accounts': DENIED,
  'GET /api/v1/accounts/:id': DENIED,
  'PATCH /api/v1/accounts/:id': DENIED,
  'DELETE /api/v1/accounts/:id': DENIED,
  'POST /api/v1/accounts/:id/archive': DENIED,
  'GET /api/v1/accounts/:id/usage': DENIED,
  'POST /api/v1/accounts/:id/delete-with-history': DENIED,
  'POST /api/v1/accounts/:id/migrate': DENIED,
  'POST /api/v1/accounts/:id/migrate/preview': DENIED,
  'POST /api/v1/accounts/:id/initial-balance': DENIED,
  'POST /api/v1/accounts/:id/initial-balance/preview': DENIED,

  'GET /api/v1/categories': DENIED,
  'POST /api/v1/categories': DENIED,
  'GET /api/v1/categories/catalog': DENIED,
  'POST /api/v1/categories/starter': DENIED,
  'PATCH /api/v1/categories/:id': DENIED,
  'DELETE /api/v1/categories/:id': DENIED,
  'GET /api/v1/categories/:id/usage': DENIED,

  'GET /api/v1/category-rules': DENIED,
  'POST /api/v1/category-rules': DENIED,
  'POST /api/v1/category-rules/preview': DENIED,
  'DELETE /api/v1/category-rules/:id': DENIED,

  'GET /api/v1/onboarding': DENIED,
  'POST /api/v1/onboarding/preview': DENIED,
  'POST /api/v1/onboarding/complete': DENIED,
  'POST /api/v1/onboarding/reset': DENIED,

  'GET /api/v1/transactions': DENIED,
  'POST /api/v1/transactions': DENIED,
  'POST /api/v1/transactions/categorize': DENIED,
  'POST /api/v1/transactions/transfer': DENIED,
  'PATCH /api/v1/transactions/:id': DENIED,
  'DELETE /api/v1/transactions/:id': DENIED,
  'PUT /api/v1/transactions/:id/splits': DENIED,
  'GET /api/v1/transactions/:id/splits': DENIED,
  'DELETE /api/v1/transactions/:id/splits': DENIED,

  'GET /api/v1/recurring-items': DENIED,
  'POST /api/v1/recurring-items': DENIED,
  'GET /api/v1/recurring-items/occurrences': DENIED,
  'GET /api/v1/recurring-items/suggestions': DENIED,
  'GET /api/v1/recurring-items/transaction-matches': DENIED,
  'GET /api/v1/recurring-items/transaction-matches/:transactionId': DENIED,
  'GET /api/v1/recurring-items/:id': DENIED,
  'PUT /api/v1/recurring-items/:id': DENIED,
  'DELETE /api/v1/recurring-items/:id': DENIED,
  'POST /api/v1/recurring-items/:id/end': DENIED,
  'GET /api/v1/recurring-items/:id/occurrences/:date': DENIED,
  'PUT /api/v1/recurring-items/:id/occurrences/:date': DENIED,
  'GET /api/v1/recurring-items/:id/occurrences/:date/candidates': DENIED,
  'POST /api/v1/recurring-items/:id/occurrences/:date/matches': DENIED,
  'DELETE /api/v1/recurring-items/:id/occurrences/:date/matches/:transactionId': DENIED,
  'POST /api/v1/recurring-items/:id/occurrences/:date/dismissals': DENIED,
  'DELETE /api/v1/recurring-items/:id/occurrences/:date/dismissals/:transactionId': DENIED,
}

/**
 * Normalises a request method for classification: Fastify answers `HEAD` with
 * the `GET` handler, so a `HEAD` is held to its `GET`'s rule.
 */
function classifiedMethod(method: string): string {
  return method === 'HEAD' ? 'GET' : method
}

/**
 * Looks a route up in {@link PLUGIN_ROUTE_ACCESS} without applying the default.
 *
 * @param method - HTTP method.
 * @param pattern - The route's registered pattern, such as `/api/v1/accounts/:id`.
 * @returns The explicit entry, or `undefined` if the route is not listed (and so is denied).
 */
export function explicitRouteAccess(method: string, pattern: string): PluginRouteAccess | undefined {
  return PLUGIN_ROUTE_ACCESS[`${classifiedMethod(method)} ${pattern}`]
}

/**
 * The plugin id a namespace route belongs to.
 *
 * @param pattern - A registered route pattern.
 * @returns The id in `/api/v1/p/<id>/...`, or `undefined` if the pattern is not in a plugin namespace
 *   or has no id (a parameter such as `:pluginId` is not an id: nobody may use it to name one).
 */
export function pluginNamespaceOf(pattern: string): string | undefined {
  if (!pattern.startsWith(PLUGIN_NAMESPACE_PREFIX)) return undefined
  const rest = pattern.slice(PLUGIN_NAMESPACE_PREFIX.length)
  const slash = rest.indexOf('/')
  const id = slash === -1 ? rest : rest.slice(0, slash)
  return id === '' || id.startsWith(':') || id.includes('*') ? undefined : id
}

/**
 * What a plugin token may do on a route, with the default applied.
 *
 * @param method - HTTP method of the request.
 * @param pattern - The matched route's registered pattern.
 * @returns The route's rule; `denied` for anything not classified.
 */
export function pluginRouteAccess(method: string, pattern: string): PluginRouteAccess {
  const pluginId = pluginNamespaceOf(pattern)
  if (pluginId !== undefined) return { kind: 'plugin-namespace', pluginId }
  return explicitRouteAccess(method, pattern) ?? DENIED
}
