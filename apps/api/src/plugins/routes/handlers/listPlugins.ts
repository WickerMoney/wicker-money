import type { FastifyInstance } from 'fastify'
import { pluginRuntimeFor } from '../../pluginRuntime.js'
import type { PluginService } from '../../service/PluginService.js'

/**
 * Registers `GET /api/v1/plugins`: the manifests the frontend should load.
 *
 * Authenticated: the plugin list reveals which features an instance runs, and
 * the widget layout is part of the user's interface rather than public data.
 * Responds `200` with `{ plugins, failures }`, each plugin being its manifest
 * plus a `bundled` flag and the `runtime` the web app must use for its UI
 * (`in-realm` or `isolated`, decided by the host and never by the manifest; see
 * `pluginRuntimeFor`); plugins that failed to load are logged as a warning
 * and listed in `failures` rather than failing the request.
 *
 * @param app - The Fastify instance to register the route on.
 * @param service - The plugin registry service.
 */
export function registerListPlugins(app: FastifyInstance, service: PluginService): void {
  app.get('/api/v1/plugins', async (request) => {
    await app.requireAuth(request)
    const { plugins, failures } = await service.loadRegistry()
    if (failures.length > 0) {
      request.log.warn({ failures }, 'some plugins failed to load')
    }
    return {
      plugins: plugins.map((p) => ({
        ...p.manifest,
        bundled: p.bundled,
        runtime: pluginRuntimeFor(p.manifest, p.bundled),
      })),
      failures,
    }
  })
}
