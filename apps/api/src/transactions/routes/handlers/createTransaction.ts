import type { FastifyInstance } from 'fastify'
import { parseBody } from '../../../http/parseBody.js'
import type { TransactionService } from '../../service/TransactionService.js'
import { createTransactionBody } from '../schemas/createTransactionBody.js'

/**
 * Registers `POST /api/v1/transactions`: records one transaction.
 *
 * When the caller supplies no category, the user's categorization rules are
 * consulted and a match is stored with source `rule`. An explicit category is
 * stored with source `manual` and is never second-guessed by a rule.
 *
 * Responds `201` with the created row. Responds `400` if the body is invalid or
 * carries a `transferAccountId` (a transfer is two rows and has its own
 * endpoint) or the category is not the caller's, `404` if the account is not
 * the caller's, and `409`
 * with code `duplicate_external_id` if the account already has a transaction
 * with the same `externalId`.
 */
export function registerCreateTransaction(app: FastifyInstance, service: TransactionService): void {
  app.post('/api/v1/transactions', async (request, reply) => {
    const user = await app.requireAuth(request)
    const body = parseBody(createTransactionBody, request.body)
    return reply.code(201).send(await service.create(user.id, body))
  })
}
