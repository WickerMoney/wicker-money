import type { Query } from '@wickermoney/plugin-sdk/server'
import { createDebtRepositories } from './repository/createDebtRepositories.js'
import type { ExportedDebt } from './repository/ExportedDebt.js'
import type { ExportedSettings } from './repository/ExportedSettings.js'

export type { ExportedDebt } from './repository/ExportedDebt.js'
export type { ExportedSettings } from './repository/ExportedSettings.js'

/**
 * Reads everything this plugin stores for the calling user, for the host's
 * "export all data" feature.
 *
 * The host does not know the `plugin_debt_payoff` schema exists, so the
 * repositories behind this function are the only place that defines the shape
 * of the export's debt data.
 *
 * It must run inside `runAsPlugin`. Row-level security has then already
 * narrowed every row to the calling user.
 *
 * @param q - A query runner already bound to the current user.
 * @returns The user's debts (archived included) in their own order, and their
 *   saved plan settings, or `null` if they have never saved any.
 */
export async function exportDebtPayoffData(
  q: Query,
): Promise<{ debts: readonly ExportedDebt[]; settings: ExportedSettings | null }> {
  const repos = createDebtRepositories(q)
  return { debts: await repos.debts.listAll(), settings: (await repos.settings.getForExport()) ?? null }
}
