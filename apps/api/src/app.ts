import { constants as zlib } from 'node:zlib'
import compress from '@fastify/compress'
import cookie from '@fastify/cookie'
import helmet from '@fastify/helmet'
import Fastify, { type FastifyInstance } from 'fastify'
import { SDK_MAJOR_VERSION } from '@wickermoney/plugin-sdk'
import { registerAccountRoutes } from './accounts/routes/index.js'
import { registerAuth } from './auth/plugin.js'
import { registerAuthRoutes } from './auth/routes/index.js'
import { registerCategoryRoutes } from './categories/routes/index.js'
import { registerCoreDataRoutes } from './core/routes/index.js'
import { createServices } from './composition/createServices.js'
import { KyselyUnitOfWork } from './data/KyselyUnitOfWork.js'
import type { Config } from './config.js'
import type { Db } from './db/client.js'
import { pingDatabase } from './db/healthcheck.js'
import { AppError } from './errors.js'
import { registerOnboardingRoutes } from './onboarding/routes/index.js'
import { registerPluginRoutes } from './plugins/routes/index.js'
import { registerRecurringItemRoutes } from './recurring/routes/index.js'
import { registerSettingsRoutes } from './settings/routes/index.js'
import { registerBundledPluginServers } from './plugins/server.js'
import { registerTransactionRoutes } from './transactions/routes/index.js'
import { registerWebApp } from './web/registerWebApp.js'
import { APP_VERSION, GIT_SHA } from './version.js'

/** Dependencies injected into {@link buildApp}. */
export interface AppDeps {
  /** Database handle, connected as the least-privilege application role. */
  readonly db: Db
  /** Validated application configuration. */
  readonly config: Config
  /**
   * Where log output goes. Defaults to stdout.
   *
   * Exposed so a test can read back what the error handler actually wrote —
   * the handler is the only record of an unhandled failure, so "does it log?"
   * needs to be assertable rather than assumed.
   */
  readonly logStream?: NodeJS.WritableStream
}

/**
 * Builds the Fastify application: error handler, health endpoints and all
 * route modules. Does not start listening.
 *
 * Errors that are {@link AppError}s are returned as `{ code, message }` with
 * their status, plus `issues` (`{ path, message }[]`) when the error carries
 * them; every `validation_failed` response does. Anything else is logged in full (including PostgreSQL
 * diagnostic fields) and returned to the client as an opaque 500
 * `internal_error`. `GET /healthz` reports liveness and the running version;
 * `GET /readyz` also queries the database and reports the plugin SDK major
 * version.
 *
 * @param deps - Database, configuration and optional log stream.
 * @returns The configured (not yet listening) Fastify instance.
 * @example
 * const app = buildApp({ db, config })
 * await app.listen({ port: config.PORT, host: config.HOST })
 */
export function buildApp({ db, config, logStream }: AppDeps): FastifyInstance {
  // `silent` rather than `logger: false`: with the logger disabled outright,
  // `request.log.error` becomes a no-op stub, so the error handler below
  // discards the cause of every 500 and the only trace of the failure is the
  // word "Something went wrong." on the client. A level still routes through a
  // real logger, so tests can silence output without also destroying it.
  const app = Fastify({
    logger: logStream === undefined
      ? { level: config.LOG_LEVEL }
      : { level: config.LOG_LEVEL, stream: logStream },
    // Explicit rather than relying on Fastify's default; routes that accept
    // larger payloads (CSV import) raise it on the route itself.
    bodyLimit: 1024 * 1024,
    trustProxy: config.TRUST_PROXY,
  })
  void app.register(helmet, { global: true })
  // The image serves the web bundle and the API from this one process, with no
  // proxy guaranteed in front, so it compresses its own responses. Only types
  // that compress (the plugin skips images, fonts and anything else already
  // dense) and only above 1 KiB, where the savings outweigh the CPU. Brotli at
  // quality 5: the default of 11 would spend hundreds of milliseconds per
  // response on a 100 KB transaction list for a few percent more. Headers
  // other than `Content-Encoding`, `Vary: Accept-Encoding` and the length are
  // left as the route set them.
  void app.register(compress, {
    global: true,
    threshold: 1024,
    encodings: ['br', 'gzip'],
    brotliOptions: { params: { [zlib.BROTLI_PARAM_QUALITY]: 5 } },
  })
  void app.register(cookie)
  const services = createServices(db, new KyselyUnitOfWork(db), config)
  const auth = services.auth

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        code: error.code,
        message: error.message,
        ...(error.issues === undefined ? {} : { issues: error.issues }),
      })
    }
    // Client mistakes that Fastify itself detects (malformed JSON, oversized or
    // unsupported bodies, rate limiting) carry a 4xx `statusCode`. They are the
    // caller's problem, not a server fault, so answer with that status at warn
    // level instead of an opaque 500 logged as an error.
    const status = (error as { statusCode?: number }).statusCode
    if (typeof status === 'number' && status >= 400 && status < 500) {
      request.log.warn({ method: request.method, url: request.url, status }, 'client error')
      const known: Record<number, [string, string]> = {
        400: ['bad_request', 'The request could not be understood.'],
        413: ['payload_too_large', 'The request body is too large.'],
        415: ['unsupported_media_type', 'Unsupported content type.'],
        429: ['rate_limited', 'Too many requests. Try again later.'],
      }
      const [code, message] = known[status] ?? ['bad_request', 'The request could not be processed.']
      return reply.code(status).send({ code, message })
    }
    // Never leak an internal message to the client; log it and return a shape
    // the frontend can rely on regardless of the failure.
    //
    // Postgres carries the diagnosis in fields pino's default error serializer
    // drops — `detail` says which constraint, `hint` usually says what to do,
    // and `code` is the one thing worth searching for. Naming them explicitly
    // is the difference between "permission denied for schema core" and a bare
    // stack trace through the query builder.
    const pg = error as { code?: string; detail?: string; hint?: string; constraint?: string }
    request.log.error(
      {
        err: error,
        method: request.method,
        url: request.url,
        pgCode: pg.code,
        pgDetail: pg.detail,
        pgHint: pg.hint,
        pgConstraint: pg.constraint,
      },
      'unhandled error',
    )
    return reply.code(500).send({ code: 'internal_error', message: 'Something went wrong.' })
  })

  // Routes are added once the compression plugin has loaded: it hooks `onRoute`,
  // so a route defined before then would be silently left uncompressed.
  app.after(() => {
    app.get('/healthz', () => ({ status: 'ok', version: APP_VERSION, gitSha: GIT_SHA }))
    app.get('/readyz', async () => {
      await pingDatabase(db)
      return { status: 'ok', version: APP_VERSION, gitSha: GIT_SHA, sdkVersion: SDK_MAJOR_VERSION }
    })

    registerAuth(app, auth)
    registerAuthRoutes(app, auth)
    registerAccountRoutes(app, services)
    registerCategoryRoutes(app, services)
    registerOnboardingRoutes(app, services)
    registerTransactionRoutes(app, services)
    registerRecurringItemRoutes(app, services)
    registerPluginRoutes(app, services)
    registerBundledPluginServers(app, db, services.plugins, {
      longStatementTimeoutMillis: config.DB_LONG_STATEMENT_TIMEOUT,
    })
    registerCoreDataRoutes(app, services)
    registerSettingsRoutes(app, services)

    // Last, so every route above wins over the static wildcard and the
    // single-page-app fallback it installs.
    if (config.WEB_DIST_DIR !== undefined) {
      registerWebApp(app, { root: config.WEB_DIST_DIR, pluginOrigins: config.PLUGIN_REMOTE_ORIGINS })
    }
  })

  return app
}
