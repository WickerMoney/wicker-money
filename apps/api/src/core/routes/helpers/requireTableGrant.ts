import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { CoreTableName } from '@wickermoney/plugin-sdk'
import type { PluginService } from '../../../plugins/service/PluginService.js'
import { ForbiddenError } from './ForbiddenError.js'
import { PLUGIN_HEADER } from './PLUGIN_HEADER.js'
import type { TableGrantGuard } from './TableGrantGuard.js'

/**
 * Builds a guard that enforces a plugin's `requiredTables` on the server.
 *
 * The host sets the plugin header on every request it proxies for a plugin,
 * and the guard checks that plugin's manifest actually grants the table. A
 * `write` grant also satisfies a `read` requirement.
 *
 * The header is advisory identification, not authentication: plugin code runs
 * in the host's origin, so a determined plugin could send any header it likes,
 * or none at all and be treated as the host application. What the guard
 * guarantees is narrower and still useful. A request that *does* name a plugin
 * is held to that plugin's manifest, and naming a plugin that is unknown,
 * disabled or malformed (an empty value, or one repeated so the values are
 * joined) is refused rather than ignored. The boundary that holds for
 * server-side plugin code is the per-plugin database role; the header check is
 * fast feedback for plugin authors.
 *
 * @param app - The Fastify instance, used to authenticate the request.
 * @param plugins - The plugin registry.
 * @param table - The core table the route reads or writes.
 * @param access - The access level the route needs. Defaults to `read`.
 * @returns A guard that resolves to the authenticated user's id. Without a
 * plugin header the request is the host application itself and is allowed,
 * still constrained by row-level security to the user's own rows.
 * @throws {ForbiddenError} (`403`) When the header is malformed, the plugin is
 * not installed or enabled, or its manifest does not grant the access.
 */
export function requireTableGrant(
  app: FastifyInstance,
  plugins: PluginService,
  table: CoreTableName,
  access: 'read' | 'write' = 'read',
): TableGrantGuard {
  return async (request: FastifyRequest): Promise<{ userId: string }> => {
    const user = await app.requireAuth(request)

    const pluginId = request.headers[PLUGIN_HEADER]
    if (pluginId === undefined) {
      // No plugin identity: this is the host application itself. Still fully
      // constrained by row-level security to the authenticated user's rows.
      return { userId: user.id }
    }
    if (typeof pluginId !== 'string') {
      throw new ForbiddenError('Malformed plugin identity header.')
    }

    const plugin = await plugins.findEnabled(pluginId)
    if (plugin === undefined) {
      throw new ForbiddenError(`Plugin '${pluginId}' is not installed or not enabled.`)
    }

    const granted = plugin.manifest.requiredTables.some(
      (g) => g.table === table && (g.access === access || g.access === 'write'),
    )
    if (!granted) {
      throw new ForbiddenError(
        `Plugin '${pluginId}' did not request ${access} access to '${table}'. ` +
          `Add it to requiredTables in the manifest.`,
      )
    }
    return { userId: user.id }
  }
}
