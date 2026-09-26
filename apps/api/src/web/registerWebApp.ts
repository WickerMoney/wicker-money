import { existsSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import fastifyStatic from '@fastify/static'
import type { FastifyInstance } from 'fastify'
import { buildContentSecurityPolicy } from './buildContentSecurityPolicy.js'
import { cacheControlFor } from './cacheControlFor.js'
import { isSpaRoute } from './isSpaRoute.js'
import type { WebAppOptions } from './WebAppOptions.js'

/**
 * Serves the built web app, and its plugin remotes, from the API process.
 *
 * One process on one origin is what the rest of the design assumes: the refresh
 * cookie is `SameSite=Strict` and scoped to `/api/v1/auth`, cookie-bearing
 * requests are checked for a matching `Origin`, and plugin remotes are
 * same-origin unless `PLUGIN_REMOTE_ORIGINS` says otherwise. A separate web
 * server would need a reverse proxy just to preserve those properties.
 *
 * Call this after every API route is registered. Files are matched by a
 * wildcard, so specific routes win; a request nothing matches falls through to
 * the not-found handler installed here, which returns `index.html` for
 * client-side routes and a JSON 404 for everything else (see {@link isSpaRoute}).
 *
 * @param app - The Fastify instance to serve from.
 * @param options - Where the build output lives and which plugin origins are allowed.
 * @throws {Error} If `root` has no `index.html`. Failing at startup beats
 *   serving a 404 for the whole UI from a container that reports healthy.
 * @example
 * registerWebApp(app, { root: '/app/web', pluginOrigins: [] })
 */
export function registerWebApp(app: FastifyInstance, { root, pluginOrigins }: WebAppOptions): void {
  const dir = resolve(root)
  if (!existsSync(join(dir, 'index.html'))) {
    throw new Error(`WEB_DIST_DIR '${root}' has no index.html. Point it at the built apps/web/dist directory.`)
  }
  const policy = buildContentSecurityPolicy(pluginOrigins)

  void app.register(fastifyStatic, {
    root: dir,
    // The plugin defaults to serving dotfiles. Nothing in a build output should
    // be one, so a stray `.env` or `.git` copied in by mistake must 404.
    dotfiles: 'ignore',
    // The plugin's own Cache-Control would be overridden below anyway; turning
    // it off keeps a single place that decides.
    cacheControl: false,
    setHeaders(reply, filePath) {
      reply.header('cache-control', cacheControlFor(relative(dir, filePath).split(sep).join('/')))
      if (filePath.endsWith('.html')) reply.header('content-security-policy', policy)
    },
  })

  app.setNotFoundHandler((request, reply) => {
    if (isSpaRoute(request.method, request.url)) return reply.sendFile('index.html')
    // Same shape Fastify produces on its own, so API clients see no change.
    return reply.code(404).send({
      message: `Route ${request.method}:${request.url} not found`,
      error: 'Not Found',
      statusCode: 404,
    })
  })
}
