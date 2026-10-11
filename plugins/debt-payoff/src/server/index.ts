/**
 * The plugin's server half.
 *
 * It is compiled by tsc and imported by the API as a workspace dependency, so
 * it lives in the plugin package rather than in the API: a plugin that owns a
 * database schema is not purely a frontend, and splitting its halves across
 * two packages would make uninstalling the plugin mean editing core.
 *
 * Bundled plugins ship inside the image, so their server code is as trusted as
 * the API itself. Every query still runs through the host's `runAsPlugin`,
 * which switches to this plugin's PostgreSQL role for the transaction, so a
 * query against a table its manifest never asked for is refused by PostgreSQL
 * rather than depending on this code's good behaviour. This plugin is granted
 * read access to core accounts and its own schema, and nothing else: it cannot
 * read another plugin's tables.
 */
export { registerDebtPayoffRoutes, DebtPayoffError } from './routes/index.js'
export type { DebtPayoffRouteDeps } from './routes/index.js'
export { DEBT_PAYOFF_PLUGIN_ID, DEBT_PAYOFF_API_BASE, MAX_ACTIVE_DEBTS } from './constants.js'
export { exportDebtPayoffData } from './export.js'
export type { ExportedDebt, ExportedSettings } from './export.js'
export { DebtPayoffService } from './service/DebtPayoffService.js'
export type { Clock } from './service/Clock.js'
