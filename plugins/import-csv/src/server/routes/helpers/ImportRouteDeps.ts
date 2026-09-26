import type { CategoryResolver } from '../../service/CategoryResolver.js'
import type { RuleLoader } from '../../repository/RuleLoader.js'
import type { RunAsPlugin } from '../../repository/RunAsPlugin.js'
import type { RouteContext } from './RouteContext.js'

/**
 * The capabilities the host hands this plugin's route registration.
 *
 * Deliberately minimal and framework-shaped rather than "here is the database":
 * the plugin never sees a connection string or the application's own database
 * handle, only a `runAsPlugin` that has already bound the user and switched to
 * this plugin's database role. Every query the routes run goes through it.
 */
export interface ImportRouteDeps {
  /** Registers one route. Paths are relative to the plugin's base. */
  readonly route: (
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    handler: (ctx: RouteContext) => Promise<unknown>,
    options?: { readonly bodyLimit?: number },
  ) => void
  /** Runs a query callback as this plugin's role, bound to the calling user. */
  readonly runAsPlugin: RunAsPlugin
  /**
   * Reads and orders this user's category rules, conditions included.
   *
   * Takes the plugin's own query runner rather than returning pre-fetched
   * rows, so rules are read once per import batch and resolved per row in
   * memory instead of costing one query per transaction. The plugin holds no
   * knowledge of rule resolution order or of a condition's column shape; both
   * live in the host function this closure wraps.
   */
  readonly getRulesForMatching: RuleLoader
  /**
   * The host's category rule engine, injected rather than reimplemented.
   *
   * The plugin may read the rules but does not decide what matching means. A
   * second copy of that logic here could drift from the one used for manual
   * entry, giving imported and hand-entered transactions different categories
   * for the same merchant.
   */
  readonly resolveCategory: CategoryResolver
}
