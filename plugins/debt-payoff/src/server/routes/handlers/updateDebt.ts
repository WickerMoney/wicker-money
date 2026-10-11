import type { DebtPayoffService } from '../../service/DebtPayoffService.js'
import type { DebtPayoffRouteDeps } from '../helpers/DebtPayoffRouteDeps.js'
import { parseBody } from '../helpers/parseBody.js'
import { requireDebtId } from '../helpers/requireDebtId.js'
import { updateDebtBody } from '../schemas/updateDebtBody.js'

/**
 * Registers `PUT /debts/:id`: changes a debt.
 *
 * Body: any of the fields `POST /debts` takes; fields not sent keep their
 * value, and `accountId: null` removes the link. At least one field is
 * required.
 *
 * Responds `200` with the debt as saved. Responds `400`
 * (`validation_failed`, `bad_body`, `bad_id`, `bad_account`), `404 not_found`,
 * or `409` (`account_already_linked`, `too_many_debts` when un-archiving).
 *
 * @param deps - The host's route registrar.
 * @param service - The debt payoff service.
 */
export function registerUpdateDebt({ route }: Pick<DebtPayoffRouteDeps, 'route'>, service: DebtPayoffService): void {
  route('PUT', '/debts/:id', async ({ userId, params, body }) =>
    service.updateDebt(userId, requireDebtId(params['id']), parseBody(updateDebtBody, body)),
  )
}
