import type { RouteContext } from './RouteContext.js'
import type { RouteMethod } from './RouteMethod.js'

/**
 * Registers one route for a plugin.
 *
 * The host mounts it under `/api/v1/p/<pluginId>`, after authentication and
 * the enabled-plugin check, so `path` is relative to the plugin's base. A
 * handler's return value is sent as the JSON response; an error it throws is
 * answered according to `PluginRouteError`.
 *
 * @param method - The HTTP method.
 * @param path - The path relative to the plugin's base, such as `/batches/:id/revert`.
 * @param handler - Handles one request.
 * @param options - `bodyLimit` raises the request-body limit, in bytes, for this route only.
 */
export type RegisterRoute = (
  method: RouteMethod,
  path: string,
  handler: (ctx: RouteContext) => Promise<unknown>,
  options?: { readonly bodyLimit?: number },
) => void
