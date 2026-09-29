import type { FastifyInstance } from 'fastify'
import { parseBody } from '../../../http/parseBody.js'
import { parseIdParam } from '../../../http/parseParams.js'
import type { RecurringItemService } from '../../service/RecurringItemService.js'
import { recurringItemBody } from '../schemas/recurringItemBody.js'

/**
 * Registers `PUT /api/v1/recurring-items/:id`: rewrites the item and its legs.
 *
 * `PUT`, not `PATCH`: an edit rewrites the whole series, legs included, and a
 * partial update of legs would need rules for merging them that nothing needs.
 * Responds `200` with the item, `400` if it breaks a rule, or `404`.
 */
export function registerUpdateRecurringItem(app: FastifyInstance, service: RecurringItemService): void {
  app.put('/api/v1/recurring-items/:id', async (request) => {
    const user = await app.requireAuth(request)
    const id = parseIdParam(request)
    const body = parseBody(recurringItemBody, request.body)
    return service.update(user.id, id, body)
  })
}
