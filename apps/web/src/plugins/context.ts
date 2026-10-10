import type { PluginApi, PluginContext, PluginManifest } from '@wickermoney/plugin-sdk'
import { activeUserId, api } from '../api/client.js'
import { responseCache } from '../api/responseCache.js'
import type { CurrentUser } from '../auth/index.js'
import { formatDate } from '../lib/formatDate.js'
import { formatMoney } from '../lib/formatMoney.js'

/** Paths a plugin may address, beyond its own namespace. */
const CORE_PREFIX = '/core/'

/**
 * Extracts the core table a path addresses.
 *
 * URLs are kebab-case and table names snake_case, so `/core/recurring-items/...`
 * addresses `recurring_items`. Without that mapping the guard would refuse a
 * granted plugin for a table name it could never have spelled.
 *
 * @param path - A request path relative to the API root.
 * @returns The table named by the segment after `/core/` (up to any `/` or `?`), or `null` if the path is not under `/core/`.
 */
function tableFromPath(path: string): string | null {
  if (!path.startsWith(CORE_PREFIX)) return null
  const rest = path.slice(CORE_PREFIX.length)
  const segment = rest.split(/[/?]/)[0]
  return segment === undefined || segment === '' ? null : segment.replaceAll('-', '_')
}

/**
 * Whether a `fetch` cache mode asks for a guaranteed-fresh read.
 *
 * Standard `RequestInit.cache` values are used as the opt-out, so the plugin
 * SDK's `PluginApi` needs no new option.
 */
function wantsFreshRead(mode: RequestCache | undefined): boolean {
  return mode === 'no-store' || mode === 'reload'
}

/**
 * Whether a `get`'s options leave the response a pure function of the URL.
 *
 * Only `signal` and a plain or fresh `cache` mode qualify. Anything else (custom
 * headers, credentials, a different cache mode) could change what comes back,
 * so such a call goes straight to the network and is neither shared nor kept.
 */
function isCacheable(init: RequestInit): boolean {
  const { cache, ...rest } = init
  const others = Object.entries(rest).some(([name, value]) => name !== 'signal' && value !== undefined)
  return !others && (cache === undefined || cache === 'default' || wantsFreshRead(cache))
}

/**
 * Builds the scoped client handed to one plugin.
 *
 * Two things happen here. The plugin's identity is attached to every request so
 * the server can check it against the manifest, which gives an honest plugin a
 * specific 403 when it asks for a table it never declared. And an obviously
 * ungranted path is refused locally, which turns that 403 into an immediate
 * error at the call site.
 *
 * Neither check is a security boundary. UI plugins are fully trusted code that
 * runs in this realm and this origin: a malicious one can call `fetch` itself,
 * omit the plugin header (the server then treats the request as the host
 * application), or obtain an access token and use it directly. Only the
 * per-plugin database role is enforced against plugin code, and it covers
 * server-side plugin code, not this client.
 *
 * `get` also goes through the per-user response cache, so widgets (from one
 * plugin or several) asking for the same URL at about the same time cost one
 * request. Plugins are separate bundles with no shared module state, which is
 * why this lives in the host. The rules, and why the plugin id is not part of
 * the key, are in `DEVELOPMENT.md` under "Request sharing in the scoped client".
 * Writes need no handling here: the client empties the cache on any non-GET.
 *
 * @param manifest - The plugin's manifest; its `requiredTables` define the grants.
 * @param userId - The signed-in user; the cache is partitioned by it and by nothing shared between users.
 * @returns A client whose methods throw synchronously for a malformed or ungranted path.
 */
function scopedApi(manifest: PluginManifest, userId: string): PluginApi {
  const granted = new Set(manifest.requiredTables.map((g) => g.table))

  const guard = (path: string): void => {
    // The client already addresses the API root, so a plugin that writes the
    // version prefix itself produces /api/v1/api/v1/... and a 404 that reads
    // like a missing route. Cheap to catch, genuinely confusing to debug.
    if (path.startsWith('/api/')) {
      throw new Error(
        `Plugin '${manifest.id}' requested '${path}'. Paths are relative to the API root — ` +
          `drop the '/api/v1' prefix.`,
      )
    }
    const table = tableFromPath(path)
    if (table === null) return
    if (!granted.has(table as never)) {
      throw new Error(
        `Plugin '${manifest.id}' has no grant for '${table}'. ` +
          `Add { table: '${table}', access: 'read' } to requiredTables.`,
      )
    }
  }

  return {
    get: async <T,>(path: string, init?: RequestInit) => {
      guard(path)
      const options = init ?? {}
      // A context built for one user must not read or fill another user's
      // bucket if it outlives a user change: the request would carry the new
      // user's token. Such a call goes straight to the network.
      const active = activeUserId()
      if (!isCacheable(options) || (active !== null && active !== userId)) {
        return api.get<T>(path, { ...options, pluginId: manifest.id })
      }

      // The key is the full URL, query included. The plugin id is left out on
      // purpose: the server uses it only to grant or refuse (a 403, never cached),
      // and the guard above has already applied the same grants to this call.
      const key = `GET ${path}`
      if (wantsFreshRead(options.cache)) {
        // Drop the remembered answer too, so the next shared read is not older than this one.
        responseCache.forget(userId, key)
        return api.get<T>(path, { ...options, pluginId: manifest.id })
      }
      // The shared request carries no caller's signal: it outlives any one caller.
      return responseCache.read(
        userId, key, () => api.get<T>(path, { pluginId: manifest.id }), options.signal,
      )
    },
    post: async <T,>(path: string, body: unknown, init?: RequestInit) => {
      guard(path)
      return api.post<T>(path, body, { ...init, pluginId: manifest.id })
    },
    put: async <T,>(path: string, body: unknown, init?: RequestInit) => {
      guard(path)
      return api.put<T>(path, body, { ...init, pluginId: manifest.id })
    },
    del: async <T,>(path: string, init?: RequestInit) => {
      guard(path)
      return api.del<T>(path, { ...init, pluginId: manifest.id })
    },
  }
}

/**
 * Builds the context object a plugin's widgets and pages receive.
 *
 * @param manifest - The plugin's manifest, used to scope its API client.
 * @param user - The signed-in user, exposed to the plugin as its session.
 * @param navigate - Navigates the host application to a route.
 * @returns The context with session details, a scoped API client, `navigate`,
 *   and `formatMoney` and `formatDate` helpers using the browser's locale.
 */
export function buildPluginContext(
  manifest: PluginManifest,
  user: CurrentUser,
  navigate: (path: string) => void,
): PluginContext {
  return {
    session: { userId: user.id, email: user.email, timezone: user.timezone },
    api: scopedApi(manifest, user.id),
    navigate,
    formatMoney,
    formatDate,
  }
}
