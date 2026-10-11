import type { FastifyInstance } from 'fastify'
import { grantsOfManifest } from '../../../auth/pluginGrants.js'
import { signPluginToken } from '../../../auth/pluginTokens.js'
import type { Config } from '../../../config.js'
import { AppError, NotFoundError } from '../../../errors.js'
import type { PluginService } from '../../service/PluginService.js'

/**
 * Registers `POST /api/v1/plugins/:pluginId/token`: mints a short-lived token
 * that speaks for one plugin, for the host's broker to attach to the requests
 * it makes on that plugin's behalf.
 *
 * Host only. The caller must hold the user's own access token. A plugin token
 * cannot mint another (or a longer-lived copy of itself): the route is
 * classified as denied for plugin tokens (`403 plugin_route_denied`), and
 * `requireAuth` would not accept one either.
 *
 * Responds `200` with `{ token, expiresAt, pluginId, grants }`, where `grants`
 * lists the plugin's `requiredTables` as `{ table, access }` entries (the same
 * set that is signed into the token), `401` without a valid access token,
 * `404 not_found` for an id that was never registered, and
 * `404 plugin_disabled` for a plugin that is registered but switched off or
 * whose manifest does not load. The token carries no more than the plugin's
 * manifest asks for today, and nothing is stored: it simply expires.
 *
 * @param app - The Fastify instance to register the route on.
 * @param plugins - The plugin registry service.
 * @param config - Configuration providing the signing secret and issuer.
 */
export function registerMintPluginToken(app: FastifyInstance, plugins: PluginService, config: Config): void {
  app.post<{ Params: { pluginId: string } }>('/api/v1/plugins/:pluginId/token', async (request) => {
    const user = await app.requireAuth(request)
    const { pluginId } = request.params

    const plugin = await plugins.findEnabled(pluginId)
    if (plugin === undefined) {
      if (!(await plugins.isRegistered(pluginId))) throw new NotFoundError('Plugin')
      throw new AppError(`Plugin '${pluginId}' is not installed or not enabled.`, 404, 'plugin_disabled')
    }

    const grants = grantsOfManifest(plugin.manifest)
    const { token, expiresAt } = await signPluginToken(config, {
      sub: user.id,
      email: user.email,
      sid: user.sessionFamilyId,
      plg: plugin.manifest.id,
      tbl: grants,
    })
    request.log.debug({ pluginId, userId: user.id }, 'plugin token minted')
    return {
      token,
      expiresAt: expiresAt.toISOString(),
      pluginId: plugin.manifest.id,
      grants: Object.entries(grants).map(([table, access]) => ({ table, access })),
    }
  })
}
