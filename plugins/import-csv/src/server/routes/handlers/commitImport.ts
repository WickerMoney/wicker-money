import type { ImportService } from '../../service/ImportService.js'
import { IMPORT_BODY_LIMIT } from '../helpers/IMPORT_BODY_LIMIT.js'
import type { ImportRouteDeps } from '../helpers/ImportRouteDeps.js'
import { readCommitRequest } from '../helpers/readCommitRequest.js'

/**
 * Registers `POST /commit`: writes the import as one batch.
 *
 * Rows classified `new` are imported; rows classified `needs-review` are
 * imported only when their row number is in `acceptRowNumbers`; duplicates are
 * never imported.
 *
 * The body may carry `idempotencyKey` (a string of 1 to 128 characters). The
 * first commit with a key imports and records it; a repeat with the same key,
 * whether sequential or concurrent, imports nothing and answers `200` with the
 * first commit's outcome and `replayed: true`.
 *
 * Responds `200` with `{ batchId, imported, skipped, flagged, failed }`. Responds
 * `400` for an invalid account id, mapping, CSV or idempotency key, or a file over 50,000 rows;
 * `404` when the account is not visible to the user; `413` when the body exceeds
 * 10 MiB; and `500` if the batch row cannot be created.
 *
 * @param deps - The host's `route` registrar.
 * @param service - The import service.
 */
export function registerCommitImport({ route }: Pick<ImportRouteDeps, 'route'>, service: ImportService): void {
  route(
    'POST',
    '/commit',
    ({ userId, body }) => service.commit(userId, readCommitRequest(body)),
    { bodyLimit: IMPORT_BODY_LIMIT },
  )
}
