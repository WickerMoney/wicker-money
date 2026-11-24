import type { DebtPayoffService } from '../../service/DebtPayoffService.js'
import type { DebtPayoffRouteDeps } from '../helpers/DebtPayoffRouteDeps.js'
import { parseBody } from '../helpers/parseBody.js'
import { requireLumpSumId } from '../helpers/requireLumpSumId.js'
import { lumpSumBody } from '../schemas/lumpSumBody.js'

/**
 * Registers `PUT /lump-sums/:id`: replaces a lump sum's date, amount, note and
 * allocations. The body is the same as `POST /lump-sums`; an allocation list
 * that is left out removes the allocations.
 *
 * Responds `200` with the lump sum, `400` as `POST /lump-sums` or `bad_id`, or
 * `404 not_found` when the user has no such lump sum, which includes one that
 * belongs to someone else.
 *
 * @param deps - The host's route registrar.
 * @param service - The debt payoff service.
 */
export function registerUpdateLumpSum({ route }: Pick<DebtPayoffRouteDeps, 'route'>, service: DebtPayoffService): void {
  route('PUT', '/lump-sums/:id', async ({ userId, params, body }) =>
    service.updateLumpSum(userId, requireLumpSumId(params['id']), parseBody(lumpSumBody, body)),
  )
}
