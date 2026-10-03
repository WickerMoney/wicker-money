import type { BudgetService } from '../../service/BudgetService.js'
import type { BudgetRouteDeps } from '../helpers/BudgetRouteDeps.js'
import { readWindowInput } from '../helpers/readWindowInput.js'

/**
 * Registers `PUT /window`: creates a window, or updates one when `id` is given.
 *
 * Body: `categoryId` (UUID), `start` and `through` (`YYYY-MM-DD`, both
 * inclusive), `planned` (non-negative decimal string: the whole amount the
 * window is funded with), and optionally `id` (UUID of the window to update)
 * and `note` (text, truncated to 300 characters).
 *
 * Responds `200` with `{ id, categoryId, start, through, planned }`. Responds
 * `400` for an invalid body (`bad_body`, `bad_id`, `bad_category`,
 * `bad_planned`, `bad_date`, `bad_note`) or dates that do not make a window
 * (`bad_window`), `404 not_found` when updating a window the caller does not
 * have, and `409 overlaps` when the category already has a line on any of
 * those days.
 *
 * @param deps - The host's route registrar.
 * @param service - The budgets service.
 */
export function registerUpsertWindow({ route }: Pick<BudgetRouteDeps, 'route'>, service: BudgetService): void {
  route('PUT', '/window', async ({ userId, body }) => service.upsertWindow(userId, readWindowInput(body)))
}
