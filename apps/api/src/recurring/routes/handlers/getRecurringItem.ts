import type { FastifyInstance } from 'fastify'
import { parseIdParam } from '../../../http/parseParams.js'
import type { RecurringItemService } from '../../service/RecurringItemService.js'

/** Registers `GET /api/v1/recurring-items/:id`. Responds `200` with the item, or `404`. */
export function registerGetRecurringItem(app: FastifyInstance, service: RecurringItemService): void {
  app.get('/api/v1/recurring-items/:id', async (request) => {
    const user = await app.requireAuth(request)
    return service.get(user.id, parseIdParam(request))
  })
}
