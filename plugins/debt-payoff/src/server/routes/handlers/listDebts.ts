import type { DebtPayoffService } from '../../service/DebtPayoffService.js'
import type { DebtPayoffRouteDeps } from '../helpers/DebtPayoffRouteDeps.js'
import { parseWith } from '../helpers/parseWith.js'
import { listDebtsQuery } from '../schemas/listDebtsQuery.js'

/**
 * Registers `GET /debts`: the user's debts in their own order.
 *
 * Query parameter: `includeArchived` (`true` to include archived debts).
 *
 * Responds `200` with `{ debts }`. Responds `400 validation_failed` for an
 * invalid parameter.
 *
 * @param deps - The host's route registrar.
 * @param service - The debt payoff service.
 */
export function registerListDebts({ route }: Pick<DebtPayoffRouteDeps, 'route'>, service: DebtPayoffService): void {
  route('GET', '/debts', async ({ userId, query }) => {
    const { includeArchived } = parseWith(listDebtsQuery, query)
    return { debts: await service.listDebts(userId, includeArchived === 'true') }
  })
}
