import type { FastifyInstance } from 'fastify'
import type { CategoryService } from '../../service/CategoryService.js'

/** Registers `GET /api/v1/categories`: the user's categories in display order. */
export function registerListCategories(app: FastifyInstance, service: CategoryService): void {
  app.get('/api/v1/categories', async (request) => {
    const user = await app.requireAuth(request)
    return service.list(user.id)
  })
}
