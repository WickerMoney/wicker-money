import type { FastifyInstance } from 'fastify'
import { parseBody } from '../../../http/parseBody.js'
import { parseIdParam } from '../../../http/parseParams.js'
import type { AccountService } from '../../service/AccountService.js'
import { migrateAccountCommitBody } from '../schemas/migrateAccountCommitBody.js'

/**
 * Registers `POST /api/v1/accounts/:id/migrate`: moves an account's
 * transactions and recurring items to another account, then deletes the
 * now-empty source.
 *
 * Responds `400` if the target is the same account or the currencies differ,
 * `404` if either account does not exist, and `409` if `confirmCount` no longer
 * matches (`usage_changed`) or both accounts hold a transaction with the same
 * external id (`external_id_collision`). Responds `200` with the merge target's
 * name and the migration counts otherwise.
 */
export function registerMigrateAccount(app: FastifyInstance, service: AccountService): void {
  app.post('/api/v1/accounts/:id/migrate', async (request) => {
    const user = await app.requireAuth(request)
    const id = parseIdParam(request)
    const body = parseBody(migrateAccountCommitBody, request.body)
    return service.migrate(user.id, id, body)
  })
}
