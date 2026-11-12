import type { UploadStore } from '../../staging/UploadStore.js'
import type { ImportRouteDeps } from '../helpers/ImportRouteDeps.js'
import { readUuid } from '../helpers/readUuid.js'

/**
 * Registers `POST /upload/abort`: discards a staged upload the caller no longer
 * wants, so a person who picks another file is not held at the 2-upload limit
 * until the first one expires.
 *
 * The body is `{ uploadId }`. Responds `200` with `{}` whether or not the id
 * named a live upload of this user (unknown, expired, imported and another
 * user's ids all look alike, so the route cannot probe ids); `400` for an id
 * that is not a UUID. An imported upload's receipt is not removed. Counted in
 * the general rate bucket.
 *
 * @param deps - The host's `route` registrar.
 * @param store - The staged uploads.
 */
export function registerUploadAbort({ route }: Pick<ImportRouteDeps, 'route'>, store: UploadStore): void {
  route('POST', '/upload/abort', async ({ userId, body }) => {
    const b = (body ?? {}) as { uploadId?: unknown }
    store.abort(userId, readUuid(b.uploadId, 'uploadId'))
    return {}
  })
}
