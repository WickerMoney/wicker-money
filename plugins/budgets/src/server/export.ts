import { createBudgetRepositories } from './repository/createBudgetRepositories.js'
import type { ExportedAccountLine } from './repository/ExportedAccountLine.js'
import type { ExportedBudgetLine } from './repository/ExportedBudgetLine.js'
import type { Query } from '@wickermoney/plugin-sdk/server'

export type { ExportedAccountLine } from './repository/ExportedAccountLine.js'
export type { ExportedBudgetLine } from './repository/ExportedBudgetLine.js'

/**
 * Reads everything this plugin stores for the calling user, for the host's
 * "export all data" feature.
 *
 * The host does not know the `plugin_budgets` schema exists, so the repository
 * behind this function is the only place that defines the shape of the
 * export's budgets data.
 *
 * It must run inside `runAsPlugin`. Row-level security has then already
 * narrowed every row to the calling user.
 *
 * @param q - A query runner already bound to the current user.
 * @returns The user's budget lines, ordered by month then category id, and
 *   their account lines, ordered by month then account id.
 */
export async function exportBudgetsData(
  q: Query,
): Promise<{ budgetLines: readonly ExportedBudgetLine[]; accountLines: readonly ExportedAccountLine[] }> {
  const repos = createBudgetRepositories(q)
  return { budgetLines: await repos.lines.listAll(), accountLines: await repos.accountLines.listAll() }
}
