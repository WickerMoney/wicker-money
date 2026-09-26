import type { FastifyInstance } from 'fastify'
import type { CategoryRuleService } from '../../service/CategoryRuleService.js'

/** Registers `GET /api/v1/category-rules`: every rule with its conditions, in resolution order. */
export function registerListCategoryRules(app: FastifyInstance, service: CategoryRuleService): void {
  app.get('/api/v1/category-rules', async (request) => {
    const user = await app.requireAuth(request)
    return service.list(user.id)
  })
}
