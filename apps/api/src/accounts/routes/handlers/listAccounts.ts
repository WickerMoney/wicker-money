import type { FastifyInstance } from 'fastify'
import { parseBody } from '../../../http/parseBody.js'
import type { AccountService } from '../../service/AccountService.js'
import { present, presentBasic } from '../helpers/present.js'
import { listAccountsQuery } from '../schemas/index.js'

/**
 * Registers `GET /api/v1/accounts`: lists the user's accounts with derived
 * balances, ordered by name.
 *
 * Archived accounts are omitted unless the `includeArchived=true` query
 * parameter is given. `fields=basic` returns only `id`, `name`, `accountType`,
 * `currencyCode`, `spendable` and `archivedAt`, and skips the balance
 * computation, which sums every transaction of every account; use it to fill a
 * picker. Any other `fields` value is a `400`.
 */
export function registerListAccounts(app: FastifyInstance, service: AccountService): void {
  app.get('/api/v1/accounts', async (request) => {
    const user = await app.requireAuth(request)
    const query = parseBody(listAccountsQuery, request.query ?? {})
    const includeArchived = query.includeArchived === 'true'
    if (query.fields === 'basic') {
      return (await service.listBasic(user.id, includeArchived)).map(presentBasic)
    }
    return (await service.list(user.id, includeArchived)).map(present)
  })
}
