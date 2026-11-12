import { CHUNK_BODY_LIMIT } from '../../staging/limits.js'
import type { UploadStore } from '../../staging/UploadStore.js'
import type { ImportRouteDeps } from '../helpers/ImportRouteDeps.js'
import { readUuid } from '../helpers/readUuid.js'

/**
 * Registers `POST /upload/chunk`: stores one chunk of a staged upload.
 *
 * The body is `{ uploadId, index, text }`. Chunks may arrive in any order and
 * several at once; the position is the `index` (0 to `chunks - 1`, as declared
 * at `begin`), so the order of arrival does not matter. `text` is 1 byte to
 * 256 KiB of UTF-8; about 200,000 characters of CSV is the intended size. A
 * chunk may end in the middle of a character pair; the pieces are joined
 * before the text is checked.
 *
 * Responds `200` with `{ chunks, received, bytes }`. Sending the same index
 * again with the same text is accepted and changes nothing, so a lost answer
 * can be retried. Responds `404` (`upload_not_found`) for an id that is
 * unknown, expired or another user's, all alike; `400` for a bad index or
 * text; `413` (`chunk_too_large`) over 256 KiB, or (`upload_too_large`, the
 * upload is discarded) when the chunks would exceed the bytes declared at
 * `begin`; `409` (`chunk_conflict`) for different text at an index already
 * stored, (`upload_finished`) after `finish`.
 *
 * The limits are checked as each chunk arrives, not at `finish`. The route is
 * counted in the general rate bucket.
 *
 * @param deps - The host's `route` registrar.
 * @param store - The staged uploads.
 */
export function registerUploadChunk({ route }: Pick<ImportRouteDeps, 'route'>, store: UploadStore): void {
  route(
    'POST',
    '/upload/chunk',
    async ({ userId, body }) => {
      const b = (body ?? {}) as { uploadId?: unknown; index?: unknown; text?: unknown }
      return store.addChunk(userId, readUuid(b.uploadId, 'uploadId'), b.index, b.text)
    },
    { bodyLimit: CHUNK_BODY_LIMIT },
  )
}
