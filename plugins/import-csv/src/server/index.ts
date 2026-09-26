/**
 * The plugin's server half: route registration and data export.
 *
 * Compiled by tsc and imported by the API as a workspace dependency. It lives
 * in the plugin package rather than in the API because a plugin that owns a
 * database schema is not purely a frontend; splitting its two halves across
 * two packages would make uninstalling the plugin mean editing the host.
 *
 * This is only safe for bundled plugins, whose server code ships in the same
 * image and is as trusted as the host. Running third-party server code would
 * need a sandbox that does not exist here, so `contributes.endpoints` must stay
 * false on any manifest that is not bundled.
 *
 * The plugin gets no free hand on the database. Every query runs through the
 * host's `runAsPlugin`, which switches to this plugin's PostgreSQL role for the
 * transaction, so PostgreSQL itself refuses a query against a table the plugin
 * never requested.
 */
export { registerImportRoutes, ImportError } from './routes/index.js'
export type {
  ConditionForMatching, RuleForMatching, ImportRouteDeps, Query, RouteContext,
} from './routes/index.js'
export { IMPORT_PLUGIN_ID } from './constants.js'
export { exportImportData } from './export.js'
export type {
  ExportedSourceMapping, ExportedImportBatch, ExportedBatchTransaction, ImportExport,
} from './repository/index.js'
