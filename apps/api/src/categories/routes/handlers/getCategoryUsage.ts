import type { FastifyInstance } from 'fastify'
import { parseIdParam } from '../../../http/parseParams.js'
import type { CategoryService } from '../../service/CategoryService.js'

/**
 * Registers `GET /api/v1/categories/:id/usage`: how many things reference a
 * category, and therefore whether it can be deleted.
 */
export function registerGetCategoryUsage(app: FastifyInstance, service: CategoryService): void {
  app.get('/api/v1/categories/:id/usage', async (request) => {
    const user = await app.requireAuth(request)
    return service.usage(user.id, parseIdParam(request))
  })
}
