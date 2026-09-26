import type { FastifyInstance } from 'fastify'
import { parseBody } from '../../../http/parseBody.js'
import type { CategoryService } from '../../service/CategoryService.js'
import { categoryBody } from '../schemas/categoryBody.js'

/**
 * Registers `POST /api/v1/categories`: creates one category.
 *
 * Responds `201` with the new row, `404` if the parent does not exist, `400`
 * if the parent is itself a child, and `409` if the slug is already taken.
 */
export function registerCreateCategory(app: FastifyInstance, service: CategoryService): void {
  app.post('/api/v1/categories', async (request, reply) => {
    const user = await app.requireAuth(request)
    const body = parseBody(categoryBody, request.body)
    return reply.code(201).send(await service.create(user.id, body))
  })
}
