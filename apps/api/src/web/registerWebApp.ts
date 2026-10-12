import { existsSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import fastifyStatic from '@fastify/static'
import type { FastifyInstance } from 'fastify'
import { buildContentSecurityPolicy } from './buildContentSecurityPolicy.js'
import { buildFrameContentSecurityPolicy } from './buildFrameContentSecurityPolicy.js'
import { cacheControlFor } from './cacheControlFor.js'
import { isSpaRoute } from './isSpaRoute.js'
import type { WebAppOptions } from './WebAppOptions.js'

/** Where the sandboxed plugin frame document is served. The built file is `plugin-frame.html`; it is never served under that name. */
export const PLUGIN_FRAME_PATH = '/plugin-frame'
const PLUGIN_FRAME_FILE = 'plugin-frame.html'

/**
 * Build output a sandboxed frame must be able to load as a module script.
 *
 * A sandboxed frame without `allow-same-origin` has the opaque origin `null`,
 * and module scripts and `import()` are fetched in CORS mode, so these files
 * need `Access-Control-Allow-Origin`. It is `*` and not `null` on purpose: the
 * files are public build output, requested without credentials, and `*` is
 * what every engine accepts. It is scoped to these two directories and never
 * set on `/api`, so no API response becomes readable cross-origin.
 */
const CORS_DIRECTORIES = ['assets/', 'plugins/']

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
 * It also serves `/plugin-frame`, the sandboxed plugin frame document with its
 * own Content-Security-Policy ({@link PLUGIN_FRAME_PATH}), and marks `assets/`
 * and `plugins/` as readable from an opaque origin (`CORS_DIRECTORIES`).
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
  // Plugin origins belong to the frame's policy only; build it once here so a bad value fails at startup, not per request.
  buildFrameContentSecurityPolicy(undefined, pluginOrigins)
  const policy = buildContentSecurityPolicy()
  const frameFile = join(dir, PLUGIN_FRAME_FILE)

  void app.register(fastifyStatic, {
    root: dir,
    // The plugin defaults to serving dotfiles. Nothing in a build output should
    // be one, so a stray `.env` or `.git` copied in by mistake must 404.
    dotfiles: 'ignore',
    // The frame document has its own route and its own policy; serving the file
    // under its real name would give it the app's (frame-ancestors 'none').
    allowedPath: (pathName) => pathName !== `/${PLUGIN_FRAME_FILE}`,
    // The plugin's own Cache-Control would be overridden below anyway; turning
    // it off keeps a single place that decides.
    cacheControl: false,
    setHeaders(reply, filePath) {
      const rel = relative(dir, filePath).split(sep).join('/')
      reply.header('cache-control', cacheControlFor(rel))
      if (rel === PLUGIN_FRAME_FILE) return
      if (filePath.endsWith('.html')) reply.header('content-security-policy', policy)
      if (CORS_DIRECTORIES.some((d) => rel.startsWith(d))) reply.header('access-control-allow-origin', '*')
    },
  })

  // The document a sandboxed plugin runs in. One static file for every plugin:
  // which plugin and module it loads is in the URL fragment, which the browser
  // never sends, so there is nothing to validate or cache per plugin here.
  app.get(PLUGIN_FRAME_PATH, (request, reply) => {
    if (!existsSync(frameFile)) {
      return reply.code(404).send({
        message: 'This build has no sandboxed plugin frame.', error: 'Not Found', statusCode: 404,
      })
    }
    // Per request because the policy names the origin the browser used, and a
    // proxy or a LAN address changes it.
    return reply
      .header('content-security-policy', buildFrameContentSecurityPolicy(`${request.protocol}://${request.host}`, pluginOrigins))
      .header('cache-control', 'no-cache')
      .header('vary', 'Host')
      .type('text/html; charset=utf-8')
      .sendFile(PLUGIN_FRAME_FILE)
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
