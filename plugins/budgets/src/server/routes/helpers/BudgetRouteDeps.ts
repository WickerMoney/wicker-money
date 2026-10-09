import type { RegisterRoute, RunAsPlugin } from '@wickermoney/plugin-sdk/server'
import type { Clock } from '../../service/Clock.js'

/**
 * What the host hands this plugin to register its routes.
 *
 * The plugin never receives a connection string or the application's own
 * database handle, only `runAsPlugin`, which has already bound the calling user
 * and switched to this plugin's PostgreSQL role. A query against a table the
 * manifest never asked for is therefore refused by PostgreSQL rather than
 * depending on this code's good behaviour.
 */
export interface BudgetRouteDeps {
  /** Registers a handler for an HTTP method and a path relative to the plugin's API base. */
  readonly route: RegisterRoute
  /** Runs `fn` in a transaction as the given user, under this plugin's database role. */
  readonly runAsPlugin: RunAsPlugin
  /** The current instant; defaults to the real clock. Lets tests fix "today". */
  readonly now?: Clock
}
