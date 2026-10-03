import { registerAdoptMonth } from './handlers/adoptMonth.js'
import { registerDeleteLine } from './handlers/deleteLine.js'
import { registerDeleteWindow } from './handlers/deleteWindow.js'
import { registerGetAtRisk } from './handlers/getAtRisk.js'
import { registerGetMonth } from './handlers/getMonth.js'
import { registerUpsertLine } from './handlers/upsertLine.js'
import { registerUpsertWindow } from './handlers/upsertWindow.js'
import { QueryBudgetUnitOfWork } from '../repository/QueryBudgetUnitOfWork.js'
import { BudgetService } from '../service/BudgetService.js'
import type { BudgetRouteDeps } from './helpers/BudgetRouteDeps.js'

export { BudgetError } from '../service/BudgetError.js'
export type { BudgetRouteDeps } from './helpers/BudgetRouteDeps.js'
export type { MonthLine } from '../service/MonthLine.js'
export type { Query } from '../repository/Query.js'
export type { RouteContext } from './helpers/RouteContext.js'

/**
 * Registers every budget endpoint through the host-supplied `route` function.
 *
 * Budgets are modelled as month instances, and two properties do most of the
 * work, both of them absences. Nothing stores `spent`: it is derived from the
 * ledger on every read, so the figure on the page and the figure in the ledger
 * cannot disagree. Nothing stores the carry-forward either: it is replayed from
 * history, so a transaction imported late against an old month corrects every
 * month after it.
 *
 * @param deps - The host-supplied `route` registrar and `runAsPlugin` runner,
 *   and optionally a clock.
 */
export function registerBudgetRoutes(deps: BudgetRouteDeps): void {
  const service = new BudgetService(new QueryBudgetUnitOfWork(deps.runAsPlugin), deps.now)
  registerGetMonth(deps, service)
  registerUpsertLine(deps, service)
  registerAdoptMonth(deps, service)
  registerDeleteLine(deps, service)
  registerGetAtRisk(deps, service)
  registerUpsertWindow(deps, service)
  registerDeleteWindow(deps, service)
}
