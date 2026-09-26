import type { FastifyInstance } from 'fastify'
import { parseBody } from '../../../http/parseBody.js'
import type { CategoryRuleService } from '../../service/CategoryRuleService.js'
import { ruleBody } from '../schemas/ruleBody.js'

/**
 * Registers `POST /api/v1/category-rules/preview`: a dry run reporting how many
 * transactions a rule would touch, without changing any.
 */
export function registerPreviewCategoryRule(app: FastifyInstance, service: CategoryRuleService): void {
  app.post('/api/v1/category-rules/preview', async (request) => {
    const user = await app.requireAuth(request)
    const body = parseBody(ruleBody, request.body)
    return service.preview(user.id, body)
  })
}
