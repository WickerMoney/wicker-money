import type { FastifyInstance } from 'fastify'
import { NotFoundError } from '../../../errors.js'
import { parseBody } from '../../../http/parseBody.js'
import type { PluginService } from '../../service/PluginService.js'
import { setPluginEnabledBody } from '../schemas/setPluginEnabledBody.js'

/**
 * Registers `PATCH /api/v1/plugins/:pluginId`: switches a plugin on or off
 * for the whole instance.
 *
 * Owner only. Body `{ enabled: boolean }`. Idempotent: repeating a request
 * changes nothing and reports `changed: false`.
 *
 * Disabling never removes data. The plugin's schema, rows and database role
 * stay, its own API routes answer `404 plugin_disabled`, and core data routes
 * refuse its identity header with `403 grant_denied`. Enabling restores all
 * of it. The change applies to this process at once; every signed-in app
 * picks it up on its next registry read.
 *
 * Responds `200` with `{ plugin, previous: { enabled }, changed, changedBy:
 * { id, email }, changedAt }` so the caller can show or record who changed
 * what, `400` for a bad body, `401`, `403` (`owner_required`) for a member,
 * and `404` for an id that is not registered. Each change is also written to
 * the server log at `info`.
 *
 * @param app - The Fastify instance to register the route on.
 * @param service - The plugin registry service.
 */
export function registerSetPluginEnabled(app: FastifyInstance, service: PluginService): void {
  app.patch<{ Params: { pluginId: string } }>('/api/v1/plugins/:pluginId', async (request) => {
    const user = await app.requireOwner(request)
    const { enabled } = parseBody(setPluginEnabledBody, request.body)
    const { pluginId } = request.params

    const result = await service.changeEnabled(pluginId, enabled)
    if (result === undefined) throw new NotFoundError('Plugin')

    const changed = result.previous !== enabled
    const changedAt = new Date().toISOString()
    if (changed) {
      request.log.info(
        { pluginId, enabled, previous: result.previous, userId: user.id },
        enabled ? 'plugin enabled' : 'plugin disabled',
      )
    }
    return {
      plugin: result.plugin,
      previous: { enabled: result.previous },
      changed,
      changedBy: { id: user.id, email: user.email },
      changedAt,
    }
  })
}
