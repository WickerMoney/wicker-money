import type { FastifyInstance } from 'fastify'
import { parseBody } from '../../../http/parseBody.js'
import { parseIdParam } from '../../../http/parseParams.js'
import type { CategoryService } from '../../service/CategoryService.js'
import { categoryPatch } from '../schemas/categoryPatch.js'

/**
 * Registers `PATCH /api/v1/categories/:id`: renames, re-parents, re-icons or
 * enables/disables one category. The slug is not editable.
 */
export function registerUpdateCategory(app: FastifyInstance, service: CategoryService): void {
  app.patch('/api/v1/categories/:id', async (request) => {
    const user = await app.requireAuth(request)
    const id = parseIdParam(request)
    const body = parseBody(categoryPatch, request.body)
    return service.update(user.id, id, body)
  })
}
