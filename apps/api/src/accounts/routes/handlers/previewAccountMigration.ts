import type { FastifyInstance } from 'fastify'
import { parseBody } from '../../../http/parseBody.js'
import { parseIdParam } from '../../../http/parseParams.js'
import type { AccountService } from '../../service/AccountService.js'
import { migrateAccountBody } from '../schemas/migrateAccountBody.js'

/**
 * Registers `POST /api/v1/accounts/:id/migrate/preview`: a dry run of a
 * migration, returning the counts a confirmation dialog needs before anything
 * moves.
 *
 * Responds `400` if the target is the same account or the currencies differ,
 * and `404` if either account does not exist.
 */
export function registerPreviewAccountMigration(app: FastifyInstance, service: AccountService): void {
  app.post('/api/v1/accounts/:id/migrate/preview', async (request) => {
    const user = await app.requireAuth(request)
    const id = parseIdParam(request)
    const body = parseBody(migrateAccountBody, request.body)
    return service.previewMigration(user.id, id, body.toAccountId)
  })
}
