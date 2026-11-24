import type { DebtPayoffService } from '../../service/DebtPayoffService.js'
import type { DebtPayoffRouteDeps } from '../helpers/DebtPayoffRouteDeps.js'
import { parseBody } from '../helpers/parseBody.js'
import { reorderDebtsBody } from '../schemas/reorderDebtsBody.js'

/**
 * Registers `PUT /debts/order`: puts the person's debts in a new order, in one
 * request.
 *
 * Body: `ids`, every one of the person's debts that is not archived, each
 * exactly once, in the order they want (first is first in line under Custom
 * order, and first in the list). Archived debts are left as they are.
 *
 * Responds `200` with `{ debts }`, the active debts in their new order, each
 * with its `sortOrder` (0, 1, 2, ...). Responds `400` (`validation_failed`,
 * `bad_body`) for a malformed body, or on the `ids` field for a list that is
 * not exactly the person's debts: `duplicate_debt` (an id twice),
 * `unknown_debt` (not one of their debts, which includes another person's) or
 * `missing_debt` (one of theirs left out). Nothing is changed on a refusal.
 *
 * Registered with a fixed path, which the router matches before
 * `PUT /debts/:id`, so `order` is never read as a debt id.
 *
 * @param deps - The host's route registrar.
 * @param service - The debt payoff service.
 */
export function registerReorderDebts({ route }: Pick<DebtPayoffRouteDeps, 'route'>, service: DebtPayoffService): void {
  route('PUT', '/debts/order', async ({ userId, body }) => ({
    debts: await service.reorderDebts(userId, parseBody(reorderDebtsBody, body).ids),
  }))
}
