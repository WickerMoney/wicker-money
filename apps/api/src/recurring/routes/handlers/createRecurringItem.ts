import type { FastifyInstance } from 'fastify'
import { parseBody } from '../../../http/parseBody.js'
import type { RecurringItemService } from '../../service/RecurringItemService.js'
import { recurringItemBody } from '../schemas/recurringItemBody.js'

/**
 * Registers `POST /api/v1/recurring-items`: creates an item and its legs in
 * one request, so an item is never stored without the legs that make it valid.
 *
 * Responds `201` with the item, or `400` naming the first rule it breaks.
 */
export function registerCreateRecurringItem(app: FastifyInstance, service: RecurringItemService): void {
  app.post('/api/v1/recurring-items', async (request, reply) => {
    const user = await app.requireAuth(request)
    const body = parseBody(recurringItemBody, request.body)
    return reply.code(201).send(await service.create(user.id, body))
  })
}
