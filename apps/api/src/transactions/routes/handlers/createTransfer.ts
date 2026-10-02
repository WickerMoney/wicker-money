import type { FastifyInstance } from 'fastify'
import { parseBody } from '../../../http/parseBody.js'
import type { TransactionService } from '../../service/TransactionService.js'
import { createTransferBody } from '../schemas/createTransferBody.js'

/**
 * Registers `POST /api/v1/transactions/transfer`: moves money between two of
 * the caller's own accounts as two linked rows (an outgoing and an incoming
 * leg sharing a `transfer_id`). Direction comes from the two accounts, so the
 * amount must be positive.
 *
 * An optional `externalId` (the source's own id, as on a single transaction)
 * is stored on both legs, so an importer can send the same transfer again
 * without doubling it.
 *
 * Responds `201` with `{ transferId, legs }`. Responds `400` if the body is
 * invalid, the two accounts are the same, or the amount is zero or negative,
 * `404` if either account does not exist or is not the caller's, and `409`
 * with code `duplicate_external_id` if either account already has a
 * transaction with that `externalId` (nothing is written).
 */
export function registerCreateTransfer(app: FastifyInstance, service: TransactionService): void {
  app.post('/api/v1/transactions/transfer', async (request, reply) => {
    const user = await app.requireAuth(request)
    const body = parseBody(createTransferBody, request.body)
    return reply.code(201).send(await service.createTransfer(user.id, body))
  })
}
