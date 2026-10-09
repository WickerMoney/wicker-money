import type { BudgetService } from '../../service/BudgetService.js'
import type { BudgetRouteDeps } from '../helpers/BudgetRouteDeps.js'
import { requireMonth } from '../helpers/requireMonth.js'
import { requireUuid } from '../helpers/requireUuid.js'

/**
 * Registers `DELETE /account-line`: removes one account's allowance for a month.
 *
 * Query parameters: `month` (`YYYY-MM`) and `accountId` (UUID).
 *
 * Responds `200` with `{ removed }`. Responds `404 not_found` when the caller
 * has no such line, which includes a line that belongs to another user, and
 * `400` with `bad_month` or `bad_account` for an invalid parameter.
 *
 * @param deps - The host's route registrar.
 * @param service - The budgets service.
 */
export function registerDeleteAccountLine(
  { route }: Pick<BudgetRouteDeps, 'route'>,
  service: BudgetService,
): void {
  route('DELETE', '/account-line', async ({ userId, query }) =>
    service.deleteAccountLine(
      userId,
      requireMonth(query['month']),
      requireUuid(query['accountId'], 'accountId', 'Choose an account.', 'bad_account'),
    ),
  )
}
