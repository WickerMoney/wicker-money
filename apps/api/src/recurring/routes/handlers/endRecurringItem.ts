import type { FastifyInstance } from 'fastify'
import { parseBody } from '../../../http/parseBody.js'
import { parseIdParam } from '../../../http/parseParams.js'
import type { RecurringItemService } from '../../service/RecurringItemService.js'
import { endSeriesBody } from '../schemas/endSeriesBody.js'

/**
 * Registers `POST /api/v1/recurring-items/:id/end`: ends the series on
 * `endDate` (default: the user's today), keeping it for reference.
 *
 * Responds `200` with the item, `400` if the date is before the series starts,
 * or `404`.
 */
export function registerEndRecurringItem(app: FastifyInstance, service: RecurringItemService): void {
  app.post('/api/v1/recurring-items/:id/end', async (request) => {
    const user = await app.requireAuth(request)
    const id = parseIdParam(request)
    const { endDate } = parseBody(endSeriesBody, request.body ?? {})
    return service.end(user.id, id, endDate)
  })
}
