import type { FastifyInstance } from 'fastify'
import { parseIdParam } from '../../../http/parseParams.js'
import type { AccountService } from '../../service/AccountService.js'
import { present } from '../helpers/present.js'

/**
 * Registers `POST /api/v1/accounts/:id/archive`: hides an account from the
 * default list while keeping the account and its history exactly as they are.
 *
 * Archiving is the safe way to retire an account that should stay in the
 * user's records, such as a closed bank account, because transactions
 * reference accounts with `ON DELETE RESTRICT` and cannot be orphaned.
 * Responds `404` if the account does not exist or is already archived.
 */
export function registerArchiveAccount(app: FastifyInstance, service: AccountService): void {
  app.post('/api/v1/accounts/:id/archive', async (request) => {
    const user = await app.requireAuth(request)
    return present(await service.archive(user.id, parseIdParam(request)))
  })
}
