import type { UploadStore } from '../../staging/UploadStore.js'
import { uploadNotFound } from '../../staging/uploadErrors.js'
import { readUploadId } from './readUploadId.js'

/**
 * Fetches the text of the staged upload an analyze body names.
 *
 * @param store - The staging store.
 * @param userId - The authenticated user.
 * @param body - The parsed JSON body, unvalidated.
 * @returns The staged text, or `undefined` when the body carries `csv` instead.
 * @throws {ImportError} `400` for a bad `uploadId` or both fields; `404`
 *   (`upload_not_found`) for an id that is unknown, expired, another user's or
 *   already imported; `409` (`upload_incomplete`) before `finish`.
 */
export function readStagedCsv(store: UploadStore, userId: string, body: unknown): string | undefined {
  const uploadId = readUploadId(body)
  if (uploadId === undefined) return undefined
  const staged = store.lookup(userId, uploadId)
  if (staged.state === 'committed') throw uploadNotFound()
  return staged.csv
}
