import type { PluginApi, PluginContext, PluginManifest } from '@wickermoney/plugin-sdk'
import { api } from '../api/client.js'
import type { CurrentUser } from '../auth/index.js'
import { formatMoney } from '../lib/formatMoney.js'

/** Paths a plugin may address, beyond its own namespace. */
const CORE_PREFIX = '/core/'

/**
 * Extracts the core table a path addresses.
 *
 * @param path - A request path relative to the API root.
 * @returns The segment after `/core/` (up to any `/` or `?`), or `null` if the path is not under `/core/`.
 */
function tableFromPath(path: string): string | null {
  if (!path.startsWith(CORE_PREFIX)) return null
  const rest = path.slice(CORE_PREFIX.length)
  const table = rest.split(/[/?]/)[0]
  return table === undefined || table === '' ? null : table
}

/**
 * Builds the scoped client handed to one plugin.
 *
 * Two things happen here. The plugin's identity is attached to every request so
 * the server can check it against the manifest — that check is the authoritative
 * one. And an obviously ungranted path is refused locally, which turns a
 * server-side 403 into an immediate, specific error at the call site.
 *
 * The local check is developer ergonomics, not a security boundary: plugin code
 * runs in this realm and could call fetch itself. Enforcement lives on the
 * server and, beneath it, in the per-plugin database role.
 *
 * @param manifest - The plugin's manifest; its `requiredTables` define the grants.
 * @returns A client whose methods throw synchronously for a malformed or ungranted path.
 */
function scopedApi(manifest: PluginManifest): PluginApi {
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
      return api.get<T>(path, { ...init, pluginId: manifest.id })
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
    api: scopedApi(manifest),
    navigate,
    formatMoney,
    formatDate: (value) => new Date(value).toLocaleDateString(),
  }
}
