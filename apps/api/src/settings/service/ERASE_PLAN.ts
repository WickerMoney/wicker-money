import { BUDGETS_PLUGIN_ID } from '@wickermoney/plugin-budgets/server'
import { DEBT_PAYOFF_PLUGIN_ID } from '@wickermoney/plugin-debt-payoff/server'
import { IMPORT_PLUGIN_ID } from '@wickermoney/plugin-import-csv/server'
import { pluginSchemaName } from '../../db/plugin-roles.js'

/** One bundled plugin's own tables, in the order they are emptied. */
export interface PluginErasePlan {
  /** The plugin's manifest id; its database role and schema are derived from it. */
  readonly pluginId: string
  /** Table names within the plugin's schema, children before the tables they reference. */
  readonly tables: readonly string[]
}

/**
 * Every table a bundled plugin keeps user data in.
 *
 * Emptied before the core tables, because a plugin's rows point at core rows
 * with `ON DELETE RESTRICT` (a budget line at its category, an import batch at
 * its account), so the core row cannot go while the plugin's row stays. Each
 * plugin is emptied under its own database role, assumed for that plugin only:
 * the application role has no privileges on a plugin's schema, and the plugin's
 * role has none outside it and its manifest's core grants, so this reaches
 * exactly what the plugin could already reach and nothing else.
 *
 * A plugin that is switched off is still listed: turning a plugin off keeps its
 * data, so erasing must not skip it.
 *
 * When a new bundled plugin gets tables, add it here. The erase refuses to run
 * while the database holds a `user_id` table this plan does not name (see
 * {@link plannedTables}), and a test fails in CI first.
 */
export const PLUGIN_ERASE_PLANS: readonly PluginErasePlan[] = [
  { pluginId: IMPORT_PLUGIN_ID, tables: ['batch_transactions', 'import_batches', 'source_mappings'] },
  { pluginId: BUDGETS_PLUGIN_ID, tables: ['account_lines', 'budget_lines'] },
  { pluginId: DEBT_PAYOFF_PLUGIN_ID, tables: ['debts', 'plan_settings'] },
]

/**
 * The `core` tables that hold a user's data, in the order they are emptied:
 * what points at a row goes before the row. Everything here also cascades from
 * its parent, so the order is for the foreign keys that do not (`RESTRICT`
 * from transactions, rules, recurring items and legs to categories and
 * accounts), not for tidiness.
 *
 * `core.sessions` is not here; it is emptied last, by itself, so the person is
 * signed out only once the rest has gone.
 */
export const CORE_ERASE_ORDER: readonly string[] = [
  'recurring_match_dismissals',
  'recurring_occurrence_legs',
  'recurring_occurrences',
  'recurring_item_legs',
  'recurring_items',
  'category_rule_conditions',
  'category_rules',
  'transaction_splits',
  'transactions',
  'categories',
  'accounts',
]

/** The one table whose rows are removed to sign the person out. */
export const SESSIONS_TABLE = 'core.sessions'

/**
 * Every `schema.table` the plan names, sessions included.
 *
 * @returns The set a catalog listing of `user_id` tables is compared against.
 */
export function plannedTables(): ReadonlySet<string> {
  const planned = new Set<string>([SESSIONS_TABLE])
  for (const table of CORE_ERASE_ORDER) planned.add(`core.${table}`)
  for (const { pluginId, tables } of PLUGIN_ERASE_PLANS) {
    for (const table of tables) planned.add(`${pluginSchemaName(pluginId)}.${table}`)
  }
  return planned
}
