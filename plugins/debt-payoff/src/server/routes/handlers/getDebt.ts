import type { DebtPayoffService } from '../../service/DebtPayoffService.js'
import type { DebtPayoffRouteDeps } from '../helpers/DebtPayoffRouteDeps.js'
import { requireDebtId } from '../helpers/requireDebtId.js'

/**
 * Registers `GET /debts/:id`: one debt.
 *
 * Responds `200` with the debt, `400 bad_id` for an id that is not a UUID, or
 * `404 not_found` when the user has no such debt, which includes a debt that
 * belongs to someone else.
 *
 * @param deps - The host's route registrar.
 * @param service - The debt payoff service.
 */
export function registerGetDebt({ route }: Pick<DebtPayoffRouteDeps, 'route'>, service: DebtPayoffService): void {
  route('GET', '/debts/:id', async ({ userId, params }) => service.getDebt(userId, requireDebtId(params['id'])))
}
