/** Paths a plugin may address, beyond its own namespace. */
export const CORE_PREFIX = '/core/'

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
export function tableFromPath(path: string): string | null {
  if (!path.startsWith(CORE_PREFIX)) return null
  const rest = path.slice(CORE_PREFIX.length)
  const segment = rest.split(/[/?]/)[0]
  return segment === undefined || segment === '' ? null : segment.replaceAll('-', '_')
}

/**
 * Checks that a path from untrusted code means what it says, and returns it.
 *
 * `fetch` collapses `.` and `..` segments before it sends anything, so
 * `/p/my.plugin/../../auth/refresh` is a request for `/auth/refresh` and a
 * prefix check on the string would wave it through. The same goes for encoded
 * separators a server might decode. Refusing any of them here means the path
 * the grant check reads is the path the server will route.
 *
 * @param path - A request path relative to the API root, with an optional query string.
 * @returns The path unchanged when it is plain, or `null` when it has a dot segment, an empty segment, an encoded dot, slash, backslash or NUL, a backslash, a control character or a fragment.
 * @example
 * plainPath('/core/transactions?limit=5') // '/core/transactions?limit=5'
 * plainPath('/p/a.b/../../auth/refresh')  // null
 */
export function plainPath(path: string): string | null {
  if (!path.startsWith('/') || path.startsWith('//')) return null
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\#]/.test(path)) return null
  const query = path.indexOf('?')
  const pathname = query === -1 ? path : path.slice(0, query)
  if (/%(?:2e|2f|5c|00)/i.test(pathname)) return null
  const segments = pathname.split('/').slice(1)
  if (segments.some((s, i) => s === '.' || s === '..' || (s === '' && i !== segments.length - 1))) return null
  return path
}

/** Why a request from a plugin frame was refused before it reached the network. */
export type PathRefusal = 'not_plain' | 'outside_grants' | 'core_is_read_only'

/**
 * Decides whether a plugin may send a request, from its manifest alone.
 *
 * This is the broker's grant check. It runs before the response cache and the
 * network, because a cache hit never reaches the server and so the server's own
 * default-deny cannot protect it. What passes is the same set the server's
 * plugin-token rules allow: a `GET` of a core table the manifest lists, and any
 * method under the plugin's own `/p/<id>/` namespace. Everything else is
 * refused here first and would be refused there again.
 *
 * @param pluginId - The plugin's manifest id.
 * @param granted - The core tables its manifest lists in `requiredTables`.
 * @param method - The HTTP method the frame asked for.
 * @param path - The path the frame asked for, relative to the API root.
 * @returns `null` when allowed, otherwise why not.
 */
export function refusalFor(
  pluginId: string, granted: ReadonlySet<string>, method: string, path: string,
): PathRefusal | null {
  if (plainPath(path) === null) return 'not_plain'
  if (path.startsWith(`/p/${pluginId}/`)) return null
  const table = tableFromPath(path)
  if (table === null || !granted.has(table)) return 'outside_grants'
  return method === 'GET' ? null : 'core_is_read_only'
}
