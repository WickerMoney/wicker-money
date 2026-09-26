import type { BudgetService } from '../../service/BudgetService.js'
import type { BudgetRouteDeps } from '../helpers/BudgetRouteDeps.js'
import { readRecord } from '../helpers/readRecord.js'
import { requireMonth } from '../helpers/requireMonth.js'

/**
 * Registers `POST /month/adopt`: copies the previous month's lines into the
 * given month in one step.
 *
 * Body: `month` (`YYYY-MM`). Responds `200` with `{ created, alreadyPlanned }`.
 * If the month already has lines nothing is written and `alreadyPlanned` is
 * their count. Responds `400 bad_month` or `bad_body` for an invalid body, and
 * `409 nothing_to_copy` when the previous month has no lines either.
 *
 * @param deps - The host's route registrar.
 * @param service - The budgets service.
 */
export function registerAdoptMonth({ route }: Pick<BudgetRouteDeps, 'route'>, service: BudgetService): void {
  route('POST', '/month/adopt', async ({ userId, body }) =>
    service.adoptMonth(userId, requireMonth(readRecord(body)['month'])),
  )
}
