import type { UploadStore } from '../../staging/UploadStore.js'
import type { ImportRouteDeps } from '../helpers/ImportRouteDeps.js'
import { readUuid } from '../helpers/readUuid.js'

/**
 * Registers `POST /upload/finish`: closes a staged upload so `analyze` and
 * `commit` can use it by `uploadId`.
 *
 * The body is `{ uploadId }`. It checks that every chunk from 0 to
 * `chunks - 1` arrived, that the bytes add up to exactly the size declared at
 * `begin`, and that the joined text is well-formed Unicode. Responds `200`
 * with `{ chunks, received, bytes }`; finishing a finished upload answers the
 * same.
 *
 * Responds `404` (`upload_not_found`) for an id that is unknown, expired or
 * another user's; `409` (`upload_incomplete`) naming the first missing
 * chunks, after which the upload stays open for them; `400`
 * (`upload_size_mismatch`, `upload_not_text`) when the chunks cannot be
 * repaired by sending more, and the upload is discarded.
 *
 * Counted in the general rate bucket.
 *
 * @param deps - The host's `route` registrar.
 * @param store - The staged uploads.
 */
export function registerUploadFinish({ route }: Pick<ImportRouteDeps, 'route'>, store: UploadStore): void {
  route('POST', '/upload/finish', async ({ userId, body }) => {
    const b = (body ?? {}) as { uploadId?: unknown }
    return store.finish(userId, readUuid(b.uploadId, 'uploadId'))
  })
}
