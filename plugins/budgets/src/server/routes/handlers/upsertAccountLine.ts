import type { BudgetService } from '../../service/BudgetService.js'
import type { BudgetRouteDeps } from '../helpers/BudgetRouteDeps.js'
import { readAccountLineInput } from '../helpers/readAccountLineInput.js'

/**
 * Registers `PUT /account-line`: creates or updates one account's allowance
 * for a month.
 *
 * Body: `month` (`YYYY-MM`), `accountId` (UUID of a checking account),
 * `planned` (non-negative decimal string), and optionally `rollover`
 * (boolean, default `true`), `excludedCategoryIds` (up to 50 category UUIDs
 * whose spending does not count) and `note` (text, truncated to 300
 * characters).
 *
 * Responds `200` with `{ id, accountId, planned, rollover, excludedCategoryIds }`.
 * Responds `400` for an invalid body (`bad_body`, `bad_month`, `bad_account`,
 * `bad_planned`, `bad_rollover`, `bad_excluded` or `bad_note`) and
 * `500 not_saved` if the write returns no row.
 *
 * @param deps - The host's route registrar.
 * @param service - The budgets service.
 */
export function registerUpsertAccountLine(
  { route }: Pick<BudgetRouteDeps, 'route'>,
  service: BudgetService,
): void {
  route('PUT', '/account-line', async ({ userId, body }) =>
    service.upsertAccountLine(userId, readAccountLineInput(body)),
  )
}
