import type { DebtPayoffService } from '../../service/DebtPayoffService.js'
import type { DebtPayoffRouteDeps } from '../helpers/DebtPayoffRouteDeps.js'
import { parseBody } from '../helpers/parseBody.js'
import { createDebtBody } from '../schemas/createDebtBody.js'

/**
 * Registers `POST /debts`: adds a debt.
 *
 * Body: `name` (1 to 100 characters), `balance`, `apr` (a percentage, such as
 * `"24.99"`) and `minimumPayment` as decimal strings, and optionally
 * `accountId` (one of the user's loan or credit card accounts, or `null`),
 * `sortOrder` and `archived`. Amounts are strings with at most four decimal
 * places; a JSON number is refused.
 *
 * Responds `200` with the created debt (plugin routes answer 200 for every success). Responds `400` (`validation_failed`,
 * `bad_body`, `bad_account`), or `409` (`account_already_linked`,
 * `too_many_debts`).
 *
 * @param deps - The host's route registrar.
 * @param service - The debt payoff service.
 */
export function registerCreateDebt({ route }: Pick<DebtPayoffRouteDeps, 'route'>, service: DebtPayoffService): void {
  route('POST', '/debts', async ({ userId, body }) => service.createDebt(userId, parseBody(createDebtBody, body)))
}
