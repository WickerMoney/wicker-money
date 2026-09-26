import type { ImportService } from '../../service/ImportService.js'
import type { ImportRouteDeps } from '../helpers/ImportRouteDeps.js'
import { readUuid } from '../helpers/readUuid.js'

/**
 * Registers `POST /batches/:id/revert`: undoes one import.
 *
 * Deletes only the untouched transactions this batch created; ones edited,
 * split, categorised by hand or turned into transfers since import are kept.
 *
 * Responds `200` with `{ reverted, skipped }` (transactions deleted, and kept
 * because they changed). Responds `400` when the id is not a UUID, `404` when no
 * such batch is visible to the user, and `409` (`already_reverted`) when the
 * batch was reverted before.
 *
 * @param deps - The host's `route` registrar.
 * @param service - The import service.
 */
export function registerRevertBatch({ route }: Pick<ImportRouteDeps, 'route'>, service: ImportService): void {
  route('POST', '/batches/:id/revert', ({ userId, params }) =>
    service.revert(userId, readUuid(params['id'], 'batch id')),
  )
}
