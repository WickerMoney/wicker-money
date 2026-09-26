import type { FastifyInstance } from 'fastify'
import { parseIdParam } from '../../../http/parseParams.js'
import type { CategoryRuleService } from '../../service/CategoryRuleService.js'

/** Registers `DELETE /api/v1/category-rules/:id`: deletes a rule. Responds `204`, or `404` if it does not exist. */
export function registerDeleteCategoryRule(app: FastifyInstance, service: CategoryRuleService): void {
  app.delete('/api/v1/category-rules/:id', async (request, reply) => {
    const user = await app.requireAuth(request)
    await service.delete(user.id, parseIdParam(request))
    return reply.code(204).send()
  })
}
