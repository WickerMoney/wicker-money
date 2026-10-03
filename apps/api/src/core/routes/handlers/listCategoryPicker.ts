import type { FastifyInstance } from 'fastify'
import type { ReportService } from '../../service/ReportService.js'
import type { TableGrantGuard } from '../helpers/TableGrantGuard.js'

/**
 * Registers `GET /api/v1/core/categories/list`: the user's enabled categories,
 * for a plugin that has to let them pick one.
 *
 * Requires a `categories` grant. Ids, names, parentage and kind only, nothing a
 * picker does not need. The kind is there so a picker can leave out categories
 * that make no sense for it, as the budgets plugin does with income and
 * transfers. A read grant lets a plugin offer the choice but not
 * create or change a category.
 *
 * Disabled categories are excluded. This is the endpoint a picker reads, and
 * the whole point of disabling a category is that it stops being offered while
 * staying attached to every transaction already filed under it. Responds `200`
 * with an array of `{ id, name, parent_id, kind }` in display order; `403` if the
 * calling plugin lacks the grant.
 *
 * @param app - The Fastify instance to register the route on.
 * @param service - The report service.
 * @param needCategories - Guard that enforces the `categories` grant.
 */
export function registerListCategoryPicker(
  app: FastifyInstance,
  service: ReportService,
  needCategories: TableGrantGuard,
): void {
  app.get('/api/v1/core/categories/list', async (request) => {
    const { userId } = await needCategories(request)
    return service.listCategoryPicker(userId)
  })
}
