import type { FastifyInstance } from 'fastify'
import { parseBody } from '../../../http/parseBody.js'
import type { AccountService } from '../../service/AccountService.js'
import { present } from '../helpers/present.js'
import { createAccountBody } from '../schemas/createAccountBody.js'

/**
 * Registers `POST /api/v1/accounts`: creates an account owned by the caller.
 *
 * Responds `201` with the new account, or `400` if the body is invalid.
 */
export function registerCreateAccount(app: FastifyInstance, service: AccountService): void {
  app.post('/api/v1/accounts', async (request, reply) => {
    const user = await app.requireAuth(request)
    const body = parseBody(createAccountBody, request.body)
    return reply.code(201).send(present(await service.create(user.id, body)))
  })
}
