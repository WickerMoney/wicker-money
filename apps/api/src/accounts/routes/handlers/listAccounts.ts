import type { FastifyInstance } from 'fastify'
import type { AccountService } from '../../service/AccountService.js'
import { present } from '../helpers/present.js'

/**
 * Registers `GET /api/v1/accounts`: lists the user's accounts with derived
 * balances, ordered by name.
 *
 * Archived accounts are omitted unless the `includeArchived=true` query
 * parameter is given.
 */
export function registerListAccounts(app: FastifyInstance, service: AccountService): void {
  app.get('/api/v1/accounts', async (request) => {
    const user = await app.requireAuth(request)
    const includeArchived = (request.query as { includeArchived?: string })?.includeArchived === 'true'
    return (await service.list(user.id, includeArchived)).map(present)
  })
}
