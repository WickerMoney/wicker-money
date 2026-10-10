import type { FastifyInstance, FastifyRequest } from 'fastify'
import { BUDGETS_PLUGIN_ID, registerBudgetRoutes } from '@wickermoney/plugin-budgets/server'
import { IMPORT_PLUGIN_ID, registerImportRoutes } from '@wickermoney/plugin-import-csv/server'
import type {
  Query, RegisterRoute, RuleForMatching, RuleSubject, RunAsPlugin,
} from '@wickermoney/plugin-sdk/server'
import { asPlugin, type Db } from '../db/client.js'
import { pluginRoleName } from '../db/plugin-roles.js'
import { resolveCategory } from '../categories/engine.js'
import { fetchRulesInResolutionOrder } from '../categories/repository/rules/fetchRulesInResolutionOrder.js'
import { AppError, type ValidationIssue } from '../errors.js'
import { queryRunner } from './queryRunner.js'
import type { PluginService } from './service/PluginService.js'

export { queryRunner } from './queryRunner.js'

/**
 * Translates a plugin's own error into one the host's handler understands.
 *
 * Anything that is not recognisably a deliberate, client-facing error is left
 * alone so it reaches the unhandled path and gets logged in full — a plugin bug
 * should look like a bug, not like a 400 the user is expected to fix.
 *
 * @param error - Whatever a plugin handler threw.
 * A plugin error may also carry `issues` in the host's `{ path, message }[]`
 * shape; they are passed on so the plugin's form can show each by its field.
 *
 * @returns An `AppError` when `error` is one already or carries a numeric
 * `statusCode` and string `code`; otherwise `error` unchanged.
 */
function toAppError(error: unknown): unknown {
  if (error instanceof AppError) return error
  if (
    error instanceof Error &&
    'statusCode' in error &&
    typeof (error as { statusCode: unknown }).statusCode === 'number' &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string'
  ) {
    const e = error as Error & { statusCode: number; code: string; issues?: unknown }
    return new AppError(e.message, e.statusCode, e.code, readIssues(e.issues))
  }
  return error
}

/**
 * Keeps a plugin error's field-level issues when they have the host's shape.
 *
 * A plugin cannot import {@link ValidationIssue}, so the shape is checked
 * rather than trusted: anything that is not an array of `{ path, message }`
 * is dropped instead of being sent to the browser as-is.
 *
 * @param value - The `issues` property of a plugin's error, if it had one.
 * @returns The issues, or `undefined` when there are none worth sending.
 */
function readIssues(value: unknown): readonly ValidationIssue[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined
  const issues: ValidationIssue[] = []
  for (const item of value as unknown[]) {
    if (typeof item !== 'object' || item === null) return undefined
    const { path, message } = item as { path?: unknown; message?: unknown }
    if (typeof message !== 'string' || !Array.isArray(path)) return undefined
    if (!path.every((p) => typeof p === 'string' || typeof p === 'number')) return undefined
    issues.push({ path: path as (string | number)[], message })
  }
  return issues
}

/**
 * Mounts the server half of bundled plugins.
 *
 * **Bundled only, and that restriction is the design.** This code ships inside
 * the image and is reviewed with the rest of the application, so it is as
 * trusted as the API itself. Running a third-party plugin's server code needs
 * an isolation story — a separate process, a resource budget, a syscall
 * boundary — that none of this provides, so `contributes.endpoints` is refused
 * for anything not in `BUNDLED_PLUGINS`.
 *
 * What a bundled plugin still does not get:
 *
 *  - The application's database handle. It receives a `runAsPlugin` that has
 *    already switched to the plugin's own PostgreSQL role, so a query outside
 *    its manifest's `requiredTables` is refused by the database.
 *  - A way to act as another user. The user id comes from the verified token on
 *    the request, never from the plugin.
 *  - Its own idea of core behaviour. Categorization is injected from the core
 *    engine rather than reimplemented, so there is one definition of what a
 *    rule matches.
 *
 * **Security posture.** The runner handed to plugins refuses statements that
 * change the database role or session settings (`SET ROLE`, `RESET ROLE`,
 * `set_config`, ...), so bundled code cannot accidentally or casually undo the
 * role and user binding established here. That is a textual screen and is
 * defence in depth for *bundled* code, which is reviewed with the rest of the
 * application. It is not a sandbox: code that assembles a statement at run
 * time can get around it, and any code in this process can also reach the
 * process's own database pool. Third-party plugin code therefore needs
 * out-of-process isolation (its own process, credentials and resource limits)
 * before it may run server-side.
 *
 * The `x-wickermoney-plugin` request header on core data routes is advisory
 * identification set by the host's own client; it is checked against the
 * registry and the manifest's grants, but it is not authentication.
 *
 * @param app - The Fastify instance to register plugin routes on.
 * @param db - The database handle used to open per-plugin transactions.
 * @param plugins - The plugin registry, consulted on every request.
 */
export function registerBundledPluginServers(app: FastifyInstance, db: Db, plugins: PluginService): void {
  const mount = (pluginId: string, register: (deps: PluginServerDeps) => void): void => {
    const role = pluginRoleName(pluginId)
    const base = `/api/v1/p/${pluginId}`

    const route: RegisterRoute = (method, path, handler, options) => {
      app.route({
        method,
        url: `${base}${path}`,
        ...(options?.bodyLimit === undefined ? {} : { bodyLimit: options.bodyLimit }),
        handler: async (request: FastifyRequest, reply) => {
          const user = await app.requireAuth(request)

          // A disabled plugin's endpoints disappear with it. Checked per
          // request rather than at boot so toggling `core.plugins` takes effect
          // without a restart — the same property the dashboard widgets have.
          if ((await plugins.findEnabled(pluginId)) === undefined) {
            throw new AppError(
              `Plugin '${pluginId}' is not installed or not enabled.`,
              404,
              'plugin_disabled',
            )
          }

          try {
            const result = await handler({
              userId: user.id,
              body: request.body,
              params: request.params as Record<string, string>,
              query: request.query as Record<string, string | undefined>,
            })
            return reply.send(result)
          } catch (error) {
            // A plugin cannot import the host's AppError — it has no dependency
            // on the API — so it throws its own error carrying a status and a
            // code. Translating here is what keeps a plugin's "that date format
            // is not one I know" a 400 with a usable message instead of an
            // opaque 500 the user cannot act on.
            throw toAppError(error)
          }
        },
      })
    }

    register({
      route,
      runAsPlugin: (userId, fn) => asPlugin(db, role, userId, (trx) => fn(queryRunner(trx))),
      // Fetching is injected alongside matching, not just matching, so the
      // plugin never has to know the rule resolution order or the row shape
      // of a condition. `q` is already the tagged-template runner that
      // `fetchRulesInResolutionOrder` wants, so no adapter is needed here.
      getRulesForMatching: (q) => fetchRulesInResolutionOrder(q),
      resolveCategory,
    })
  }

  mount(IMPORT_PLUGIN_ID, registerImportRoutes)
  // Budgets needs no injected core behaviour — it reads the ledger and derives
  // its own figures — so it destructures only the two deps it uses. A plugin
  // taking less than it is offered is the shape to encourage.
  mount(BUDGETS_PLUGIN_ID, registerBudgetRoutes)
}

/** Everything the host hands a bundled plugin's `register` function to mount its routes and reach core behaviour. */
interface PluginServerDeps {
  /** Mounts one route under `/api/v1/p/<pluginId>`, after authentication and the enabled-plugin check. */
  readonly route: RegisterRoute
  /** Runs `fn` in a transaction under the plugin's own database role, with row-level security scoped to `userId`. */
  readonly runAsPlugin: RunAsPlugin
  /**
   * Reads and orders this user's category rules, conditions included.
   *
   * Takes a query runner rather than returning pre-fetched rows so a caller can
   * read the rules once per batch instead of once per transaction.
   */
  readonly getRulesForMatching: (q: Query) => Promise<readonly RuleForMatching[]>
  /** Picks the category id the given rules assign to a transaction, or `null` when none matches. */
  readonly resolveCategory: (rules: readonly RuleForMatching[], subject: RuleSubject) => string | null
}
