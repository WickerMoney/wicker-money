import type { FastifyInstance } from 'fastify'
import { parseIdParam } from '../../../http/parseParams.js'
import type { CategoryService } from '../../service/CategoryService.js'

/**
 * Registers `DELETE /api/v1/categories/:id`: deletes a category that nothing
 * references. Responds `204`, `404` if it does not exist, or `409` with an
 * explanation if it is still in use.
 */
export function registerDeleteCategory(app: FastifyInstance, service: CategoryService): void {
  app.delete('/api/v1/categories/:id', async (request, reply) => {
    const user = await app.requireAuth(request)
    await service.delete(user.id, parseIdParam(request))
    return reply.code(204).send()
  })
}
