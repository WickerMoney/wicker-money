import type { FastifyInstance } from 'fastify'
import type { CategoryService } from '../../service/CategoryService.js'

/**
 * Registers `GET /api/v1/categories/catalog`: the full category catalog as
 * inert data, so a client can show what a situation would add before adding it.
 */
export function registerGetCategoryCatalog(app: FastifyInstance, service: CategoryService): void {
  app.get('/api/v1/categories/catalog', async (request) => {
    await app.requireAuth(request)
    return service.catalog()
  })
}
