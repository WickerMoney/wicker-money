import type { DebtPayoffService } from '../../service/DebtPayoffService.js'
import type { DebtPayoffRouteDeps } from '../helpers/DebtPayoffRouteDeps.js'
import { requireDebtId } from '../helpers/requireDebtId.js'

/**
 * Registers `DELETE /debts/:id`: removes a debt.
 *
 * Responds `200` with `{ removed: 1 }`, `400 bad_id`, or `404 not_found` when
 * the user has no such debt, which includes a debt that belongs to someone
 * else.
 *
 * @param deps - The host's route registrar.
 * @param service - The debt payoff service.
 */
export function registerDeleteDebt({ route }: Pick<DebtPayoffRouteDeps, 'route'>, service: DebtPayoffService): void {
  route('DELETE', '/debts/:id', async ({ userId, params }) => service.deleteDebt(userId, requireDebtId(params['id'])))
}
