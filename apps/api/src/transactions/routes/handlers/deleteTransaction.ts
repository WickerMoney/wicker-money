import type { FastifyInstance } from 'fastify'
import { parseIdParam } from '../../../http/parseParams.js'
import type { TransactionService } from '../../service/TransactionService.js'

/**
 * Registers `DELETE /api/v1/transactions/:id`: deletes a transaction, or both
 * legs of a transfer.
 *
 * Responds `204` with no body on success, as it always has. With `?undo=1` it
 * answers `200` with `{ undo }` instead: `undo` is `{ id, expiresAt, kind }`
 * for the snapshot that `POST /api/v1/transaction-undos/:id/restore` accepts,
 * or `null` when none was written (Undo is off, or the snapshot was over the
 * size cap). Any other value of `undo` is ignored. Responds `400` if the id is
 * not a UUID, and `404` if the transaction does not exist.
 *
 * The flag is for the signed-in person's own session: a plugin token is refused
 * on this route before the handler runs, and `requireAuth` takes no other kind
 * of token.
 */
export function registerDeleteTransaction(app: FastifyInstance, service: TransactionService): void {
  app.delete('/api/v1/transactions/:id', async (request, reply) => {
    const user = await app.requireAuth(request)
    const wantsUndo = (request.query as { undo?: unknown } | undefined)?.undo === '1'
    const snapshot = await service.remove(user.id, parseIdParam(request), { undo: wantsUndo })
    if (!wantsUndo) return reply.code(204).send()
    return reply.code(200).send({
      undo: snapshot === null
        ? null
        : { id: snapshot.id, expiresAt: snapshot.expiresAt.toISOString(), kind: snapshot.kind },
    })
  })
}
