import type { FastifyInstance } from 'fastify'
import { parseIdParam } from '../../../http/parseParams.js'
import type { TransactionUndoService } from '../../service/TransactionUndoService.js'

/**
 * Registers `POST /api/v1/transaction-undos/:id/restore`: puts back a
 * transaction (or both legs of a transfer) that a delete with `?undo=1` saved.
 * No body.
 *
 * Responds `200` with `{ restored, relinkedMatch, restoredDismissals,
 * skippedDismissals }`. Responds `400` if the id is not a UUID; `404`
 * `not_found` if the snapshot does not exist, is not the caller's, has been
 * purged, or Undo is off (all the same answer, so an id cannot be probed);
 * `410` `undo_expired`; and `409` `already_undone`, `undo_conflict` (an
 * `external_id` is now used by another transaction) or `undo_unavailable` (an
 * account or category was deleted since). Every refusal leaves the snapshot as
 * it was.
 *
 * Closed to plugin tokens (and to the personal tokens ADR 0012 describes): it
 * is `DENIED` in `PLUGIN_ROUTE_ACCESS`, and `requireAuth` takes no other token.
 */
export function registerRestoreTransactionUndo(app: FastifyInstance, service: TransactionUndoService): void {
  app.post('/api/v1/transaction-undos/:id/restore', async (request) => {
    const user = await app.requireAuth(request)
    return service.restore(user.id, parseIdParam(request))
  })
}
