import { exportBudgetsData, BUDGETS_PLUGIN_ID } from '@wickermoney/plugin-budgets/server'
import { exportImportData, IMPORT_PLUGIN_ID } from '@wickermoney/plugin-import-csv/server'
import type { PluginExporter } from './PluginExporter.js'

/**
 * Bundled plugins that can produce their own export data, keyed by plugin id.
 *
 * Static rather than discovered: only bundled plugins are trusted to run
 * server-side code at all, so there is no third-party case to dispatch to yet.
 */
export const EXPORTERS: Readonly<Record<string, PluginExporter>> = {
  [BUDGETS_PLUGIN_ID]: exportBudgetsData,
  [IMPORT_PLUGIN_ID]: exportImportData,
}
