import type { FastifyInstance } from 'fastify'
import { parseBody } from '../../../http/parseBody.js'
import type { CategoryRuleService } from '../../service/CategoryRuleService.js'
import { ruleBody } from '../schemas/ruleBody.js'

/**
 * Registers `POST /api/v1/category-rules`: creates a rule with its conditions
 * and applies it to eligible transactions.
 *
 * Responds `201` with `{ rule, recategorized }`.
 */
export function registerCreateCategoryRule(app: FastifyInstance, service: CategoryRuleService): void {
  app.post('/api/v1/category-rules', async (request, reply) => {
    const user = await app.requireAuth(request)
    const body = parseBody(ruleBody, request.body)
    return reply.code(201).send(await service.create(user.id, body))
  })
}
