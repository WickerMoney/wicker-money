import { ImportError } from '../../service/ImportError.js'
import { readUuid } from './readUuid.js'

/**
 * Reads the optional `uploadId` of an analyze or commit body.
 *
 * A file comes either inline (`csv`) or from a staged upload (`uploadId`),
 * never both: sending both would leave it open which one is imported.
 *
 * @param body - The parsed JSON body, unvalidated.
 * @returns The upload id, or `undefined` when the request carries `csv` instead.
 * @throws {ImportError} `400` when `uploadId` is not a UUID, or when both `csv` and `uploadId` are present.
 */
export function readUploadId(body: unknown): string | undefined {
  const b = (body ?? {}) as { csv?: unknown; uploadId?: unknown }
  if (b.uploadId === undefined || b.uploadId === null) return undefined
  if (b.csv !== undefined && b.csv !== null) {
    throw ImportError.field(['uploadId'], 'Send the file either as csv or as an uploadId, not both.')
  }
  return readUuid(b.uploadId, 'uploadId')
}
