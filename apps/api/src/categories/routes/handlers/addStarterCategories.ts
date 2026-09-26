import type { FastifyInstance } from 'fastify'
import { parseBody } from '../../../http/parseBody.js'
import type { CategoryService } from '../../service/CategoryService.js'
import { starterBody } from '../schemas/starterBody.js'

/**
 * Registers `POST /api/v1/categories/starter`: creates the catalog entries
 * matching a set of situations. Additive and idempotent.
 */
export function registerAddStarterCategories(app: FastifyInstance, service: CategoryService): void {
  app.post('/api/v1/categories/starter', async (request) => {
    const user = await app.requireAuth(request)
    const body = parseBody(starterBody, request.body)
    return service.addStarter(user.id, body.situations)
  })
}
