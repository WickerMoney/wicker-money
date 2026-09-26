import type { FastifyInstance } from 'fastify'
import { parseBody } from '../../../http/parseBody.js'
import { parseIdParam } from '../../../http/parseParams.js'
import type { AccountService } from '../../service/AccountService.js'
import { present } from '../helpers/present.js'
import { updateAccountBody } from '../schemas/updateAccountBody.js'

/**
 * Registers `PATCH /api/v1/accounts/:id`: edits the fields present in the body
 * and leaves the rest untouched.
 *
 * The opening balance cannot be changed here. Responds `400` if the body is
 * invalid and `404` if the account does not exist.
 */
export function registerUpdateAccount(app: FastifyInstance, service: AccountService): void {
  app.patch('/api/v1/accounts/:id', async (request) => {
    const user = await app.requireAuth(request)
    const id = parseIdParam(request)
    const body = parseBody(updateAccountBody, request.body)
    return present(await service.update(user.id, id, body))
  })
}
