/**
 * The plugin's server half.
 *
 * It is compiled by tsc and imported by the API as a workspace dependency, so
 * it lives in the plugin package rather than in the API: a plugin that owns a
 * database schema is not purely a frontend, and splitting its halves across two
 * packages would make uninstalling the plugin mean editing core.
 *
 * This works because bundled plugins ship inside the image, so their server
 * code is as trusted as the API itself. Running a third-party plugin's server
 * code would need a sandbox that does not exist, so `contributes.endpoints`
 * must stay false on any manifest that is not bundled.
 *
 * The plugin still does not get a free hand on the database. Every query runs
 * through the host's `runAsPlugin`, which switches to this plugin's PostgreSQL
 * role for the transaction, so a query against a table its manifest never asked
 * for is refused by PostgreSQL rather than depending on this code's good
 * behaviour.
 */
export { registerBudgetRoutes, BudgetError } from './routes/index.js'
export type { BudgetRouteDeps, MonthLine } from './routes/index.js'
export { BUDGETS_PLUGIN_ID, BUDGETS_API_BASE, CARRY_LOOKBACK_MONTHS } from './constants.js'
export { exportBudgetsData } from './export.js'
export type { ExportedAccountLine, ExportedBudgetLine } from './export.js'
export { BudgetService } from './service/BudgetService.js'
export type { Clock } from './service/Clock.js'
