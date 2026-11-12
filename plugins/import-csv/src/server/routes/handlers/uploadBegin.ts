import type { UploadStore } from '../../staging/UploadStore.js'
import type { ImportRouteDeps } from '../helpers/ImportRouteDeps.js'

/**
 * Registers `POST /upload/begin`: opens a staged upload for a file too large
 * for one request (the plugin broker's messages stop at 256 KiB).
 *
 * The body is `{ chunks, bytes }`: how many chunks the file will be sent in
 * (1 to 64) and the exact size of the whole text in bytes of UTF-8 (1 to
 * 8,000,000). Chunk indexes then run from 0 to `chunks - 1`. Responds `200`
 * with `{ uploadId, chunks, bytes, expiresInSeconds }`.
 *
 * Responds `400` for numbers outside those limits (or a chunk count that
 * cannot hold the bytes at 256 KiB a chunk); `409` (`too_many_uploads`) when
 * the user already has 2 live uploads; `503` (`staging_full`, with
 * `Retry-After`) when all users together hold 64,000,000 bytes of staged
 * files. The space is reserved here, before any data is sent. An upload
 * expires 15 minutes after its last new chunk.
 *
 * The route counts in the strict import rate bucket, one request per upload;
 * `/upload/chunk` and `/upload/finish` count in the general bucket.
 *
 * @param deps - The host's `route` registrar.
 * @param store - The staged uploads.
 */
export function registerUploadBegin({ route }: Pick<ImportRouteDeps, 'route'>, store: UploadStore): void {
  route('POST', '/upload/begin', async ({ userId, body }) => {
    const b = (body ?? {}) as { chunks?: unknown; bytes?: unknown }
    return store.begin(userId, b.chunks, b.bytes)
  })
}
