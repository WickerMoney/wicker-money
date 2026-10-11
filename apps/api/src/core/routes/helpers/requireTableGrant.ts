import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { CoreTableName } from '@wickermoney/plugin-sdk'
import { grantAllows } from '../../../auth/pluginGrants.js'
import type { PluginService } from '../../../plugins/service/PluginService.js'
import { ForbiddenError } from './ForbiddenError.js'
import { PLUGIN_HEADER } from './PLUGIN_HEADER.js'
import type { TableGrantGuard } from './TableGrantGuard.js'

/**
 * Builds a guard that enforces a table grant on a core data route.
 *
 * Who is asking is decided by the bearer token, never by a header:
 *
 * - **A plugin token** (the host broker's short-lived token for one plugin) is
 *   attributed to the plugin in its signed claims. The guard allows the request
 *   only if that plugin holds the table at the access level the route needs
 *   (`write` also satisfies `read`). The grants it checks were settled by the
 *   token hook in `auth/plugin.ts`: the token's grants narrowed to the plugin's
 *   current manifest, for a plugin that is still enabled. The
 *   `x-wickermoney-plugin` header is ignored on such a request, so it can
 *   neither widen the plugin's access nor name a different plugin.
 * - **The host's access token** is the host application. It is allowed, still
 *   constrained by row-level security to the user's own rows. If the request
 *   also carries `x-wickermoney-plugin`, the guard holds it to that plugin's
 *   manifest as before; that is a courtesy to first-party plugin code that
 *   still runs in the host page and sends the header, so a mistake in it fails
 *   fast. It is advisory only: it can narrow a host request, never widen one,
 *   and a caller holding the host token can omit it.
 *
 * **What this does not do.** A UI plugin that runs in the host's page and
 * origin can reach the host's own access token, and with it every route the
 * signed-in user can, whatever its manifest says. Plugin tokens give the server
 * an identity it can verify and enforce, but they protect nothing until the
 * plugin's code is kept from the host token, which is the job of the isolated
 * plugin runtime. Until then UI plugin code is trusted code, which is why
 * third-party install is not supported and `PLUGIN_REMOTE_ORIGINS` must stay
 * empty unless you trust the origin completely. The boundary that holds for
 * server-side plugin code is the per-plugin PostgreSQL role (bundled plugins'
 * `runAsPlugin`), not these routes, which run as the application role.
 *
 * @param app - The Fastify instance, used to authenticate the request.
 * @param plugins - The plugin registry.
 * @param table - The core table the route reads or writes.
 * @param access - The access level the route needs. Defaults to `read`.
 * @returns A guard that resolves to the authenticated user's id.
 * @throws {ForbiddenError} (`403`) When a plugin token does not grant the
 * table at the needed level, or (host token with the advisory header) when
 * the header is malformed, the plugin is not installed or enabled, or its
 * manifest does not grant the access.
 */
export function requireTableGrant(
  app: FastifyInstance,
  plugins: PluginService,
  table: CoreTableName,
  access: 'read' | 'write' = 'read',
): TableGrantGuard {
  return async (request: FastifyRequest): Promise<{ userId: string }> => {
    const { user, plugin: principal } = await app.requireActor(request)

    if (principal !== undefined) {
      if (!grantAllows(principal.grants, table, access)) {
        throw new ForbiddenError(
          `Plugin '${principal.pluginId}' was not granted ${access} access to '${table}'. ` +
            `Add it to requiredTables in the manifest.`,
        )
      }
      return { userId: user.id }
    }

    const pluginId = request.headers[PLUGIN_HEADER]
    if (pluginId === undefined) {
      // The host's own token and no advisory header: the host application
      // itself. Still fully constrained by row-level security to the user's rows.
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
