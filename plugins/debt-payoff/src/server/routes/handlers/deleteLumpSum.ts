import type { DebtPayoffService } from '../../service/DebtPayoffService.js'
import type { DebtPayoffRouteDeps } from '../helpers/DebtPayoffRouteDeps.js'
import { requireLumpSumId } from '../helpers/requireLumpSumId.js'

/**
 * Registers `DELETE /lump-sums/:id`: removes a lump sum and its allocations.
 *
 * Responds `200` with `{ removed: 1 }`, `400 bad_id`, or `404 not_found` when
 * the user has no such lump sum, which includes one that belongs to someone
 * else.
 *
 * @param deps - The host's route registrar.
 * @param service - The debt payoff service.
 */
export function registerDeleteLumpSum({ route }: Pick<DebtPayoffRouteDeps, 'route'>, service: DebtPayoffService): void {
  route('DELETE', '/lump-sums/:id', async ({ userId, params }) => service.deleteLumpSum(userId, requireLumpSumId(params['id'])))
}
