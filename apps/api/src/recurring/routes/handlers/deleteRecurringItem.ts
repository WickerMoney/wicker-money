import type { FastifyInstance } from 'fastify'
import { parseIdParam } from '../../../http/parseParams.js'
import type { RecurringItemService } from '../../service/RecurringItemService.js'

/** Registers `DELETE /api/v1/recurring-items/:id`: deletes the item and its legs. Responds `204`, or `404`. */
export function registerDeleteRecurringItem(app: FastifyInstance, service: RecurringItemService): void {
  app.delete('/api/v1/recurring-items/:id', async (request, reply) => {
    const user = await app.requireAuth(request)
    await service.delete(user.id, parseIdParam(request))
    return reply.code(204).send()
  })
}
