import type { DebtPayoffService } from '../../service/DebtPayoffService.js'
import type { DebtPayoffRouteDeps } from '../helpers/DebtPayoffRouteDeps.js'
import { parseBody } from '../helpers/parseBody.js'
import { lumpSumBody } from '../schemas/lumpSumBody.js'

/**
 * Registers `POST /lump-sums`: adds a lump sum.
 *
 * Body: `onDate` (`YYYY-MM-DD`), `amount` (a decimal string above zero, never a
 * JSON number), and optionally `note` (up to 200 characters) and `allocations`,
 * a list of `{ debtId, amount }` aiming part of it at one of the person's own
 * debts, each debt at most once, adding up to no more than `amount`. What is
 * not allocated follows the strategy.
 *
 * Responds `200` with the lump sum (plugin routes answer 200 for every
 * success). Responds `400` (`validation_failed`, `bad_body`; on `allocations`:
 * `unknown_debt`, `duplicate_debt`, `allocation_too_large`) or `409
 * too_many_lump_sums`.
 *
 * @param deps - The host's route registrar.
 * @param service - The debt payoff service.
 */
export function registerCreateLumpSum({ route }: Pick<DebtPayoffRouteDeps, 'route'>, service: DebtPayoffService): void {
  route('POST', '/lump-sums', async ({ userId, body }) => service.createLumpSum(userId, parseBody(lumpSumBody, body)))
}
