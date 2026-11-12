import type { ImportService } from '../../service/ImportService.js'
import { IMPORT_BODY_LIMIT } from '../helpers/IMPORT_BODY_LIMIT.js'
import type { ImportRouteDeps } from '../helpers/ImportRouteDeps.js'
import { readCommitRequest } from '../helpers/readCommitRequest.js'
import { readIdempotencyKey } from '../helpers/readIdempotencyKey.js'
import { readUploadId } from '../helpers/readUploadId.js'
import type { UploadStore } from '../../staging/UploadStore.js'
import { uploadNotFound } from '../../staging/uploadErrors.js'

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
 * The file is `csv` or a finished staged `uploadId` (see `/upload/begin`),
 * never both, and is imported by the same code either way. A successful commit
 * of an upload frees its text. If it carried an `idempotencyKey`, a repeat of
 * the same `uploadId` and key within 15 minutes answers with the first
 * outcome and `replayed: true`; an `uploadId` that is gone, or a different key
 * for an imported upload, is `404` (`upload_not_found`). A commit that fails
 * leaves the upload in place for a retry until it expires.
 *
 * Responds `200` with `{ batchId, imported, skipped, flagged, failed }`. Responds
 * `400` for an invalid account id, mapping, CSV or idempotency key, or a file over the row limit (`IMPORT_MAX_ROWS`);
 * `404` when the account is not visible to the user; `413` when the body exceeds
 * 10 MiB; and `500` if the batch row cannot be created.
 *
 * The route is `longRunning`: it runs under the host's long statement limit,
 * because it waits for the account lock behind a concurrent import.
 *
 * @param deps - The host's `route` registrar.
 * @param service - The import service.
 * @param store - The staged uploads.
 */
export function registerCommitImport(
  { route }: Pick<ImportRouteDeps, 'route'>,
  service: ImportService,
  store: UploadStore,
): void {
  route(
    'POST',
    '/commit',
    async ({ userId, body }) => {
      const uploadId = readUploadId(body)
      if (uploadId === undefined) return service.commit(userId, readCommitRequest(body))

      const staged = store.lookup(userId, uploadId)
      if (staged.state === 'committed') {
        // This upload was imported already: only a retry of that very commit
        // (same key) is answered, from the batch the key was recorded on.
        const key = readIdempotencyKey((body as { idempotencyKey?: unknown }).idempotencyKey)
        if (key === undefined || key !== staged.receipt.idempotencyKey) throw uploadNotFound()
        return service.replayCommit(userId, key, staged.receipt.failed)
      }
      const input = readCommitRequest(body, staged.csv)
      const result = await service.commit(userId, input)
      // Even when the caller has gone away: the handler runs to its end, so the
      // text is freed here and not left to wait for expiry.
      store.markCommitted(
        userId,
        uploadId,
        input.idempotencyKey === undefined ? undefined : { idempotencyKey: input.idempotencyKey, failed: result.failed },
      )
      return result
    },
    { bodyLimit: IMPORT_BODY_LIMIT, longRunning: true },
  )
}
