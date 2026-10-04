import type { FastifyInstance } from 'fastify'
import { parseBody } from '../../../http/parseBody.js'
import type { RecurringOccurrenceService } from '../../service/RecurringOccurrenceService.js'
import { matchParams } from '../schemas/occurrenceParams.js'

/**
 * Registers `DELETE /api/v1/recurring-items/:id/occurrences/:date/dismissals/:transactionId`:
 * undoes a dismissal, so the pair can be suggested again.
 *
 * Responds `204`, or `404` when there is no such dismissal.
 */
export function registerUndismissSuggestion(app: FastifyInstance, service: RecurringOccurrenceService): void {
  app.delete('/api/v1/recurring-items/:id/occurrences/:date/dismissals/:transactionId', async (request, reply) => {
    const user = await app.requireAuth(request)
    const { id, date, transactionId } = parseBody(matchParams, request.params)
    await service.undismiss(user.id, id, date, transactionId)
    return reply.code(204).send()
  })
}
