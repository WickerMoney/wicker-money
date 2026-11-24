import { QueryDebtUnitOfWork } from '../repository/QueryDebtUnitOfWork.js'
import { DebtPayoffService } from '../service/DebtPayoffService.js'
import { registerCreateDebt } from './handlers/createDebt.js'
import { registerCreateLumpSum } from './handlers/createLumpSum.js'
import { registerDeleteDebt } from './handlers/deleteDebt.js'
import { registerDeleteLumpSum } from './handlers/deleteLumpSum.js'
import { registerGetDebt } from './handlers/getDebt.js'
import { registerGetPlan } from './handlers/getPlan.js'
import { registerGetSettings } from './handlers/getSettings.js'
import { registerListAccountSuggestions } from './handlers/listAccountSuggestions.js'
import { registerListDebts } from './handlers/listDebts.js'
import { registerListLumpSums } from './handlers/listLumpSums.js'
import { registerReorderDebts } from './handlers/reorderDebts.js'
import { registerSaveSettings } from './handlers/saveSettings.js'
import { registerUpdateDebt } from './handlers/updateDebt.js'
import { registerUpdateLumpSum } from './handlers/updateLumpSum.js'
import { registerWhatIf } from './handlers/whatIf.js'
import type { DebtPayoffRouteDeps } from './helpers/DebtPayoffRouteDeps.js'

export { DebtPayoffError } from '../service/DebtPayoffError.js'
export type { DebtPayoffRouteDeps } from './helpers/DebtPayoffRouteDeps.js'

/**
 * Registers every debt payoff endpoint through the host-supplied `route` function.
 *
 * Nothing derived is stored: the schedule, the interest and the debt-free date
 * are computed from the debts and settings on every request, so what the page
 * shows cannot disagree with the debts it lists.
 *
 * @param deps - The host-supplied `route` registrar and `runAsPlugin` runner,
 *   and optionally a clock.
 */
export function registerDebtPayoffRoutes(deps: DebtPayoffRouteDeps): void {
  const service = new DebtPayoffService(new QueryDebtUnitOfWork(deps.runAsPlugin), deps.now)
  registerListDebts(deps, service)
  registerCreateDebt(deps, service)
  registerGetDebt(deps, service)
  registerUpdateDebt(deps, service)
  registerReorderDebts(deps, service)
  registerDeleteDebt(deps, service)
  registerGetSettings(deps, service)
  registerSaveSettings(deps, service)
  registerGetPlan(deps, service)
  registerWhatIf(deps, service)
  registerListLumpSums(deps, service)
  registerCreateLumpSum(deps, service)
  registerUpdateLumpSum(deps, service)
  registerDeleteLumpSum(deps, service)
  registerListAccountSuggestions(deps, service)
}
