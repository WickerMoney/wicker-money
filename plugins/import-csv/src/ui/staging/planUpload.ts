import { splitIntoChunks } from './splitIntoChunks.js'
import { StagingFailure } from './StagingFailure.js'
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_CHUNKS } from './stagingLimits.js'
import { utf8Bytes } from './utf8Bytes.js'

/** A file's text cut into the pieces it is uploaded in, and its exact size. */
export interface UploadPlan {
  /** The pieces, in order. Joined they are the text. */
  readonly chunks: readonly string[]
  /** The size of the whole text in bytes of UTF-8, which `begin` declares. */
  readonly bytes: number
}

/**
 * Decides how a file's text is uploaded, and refuses what the server never
 * would take, before anything is sent.
 *
 * @param text - The file's text, as read from the file.
 * @returns The pieces and the exact byte size.
 * @throws {StagingFailure} `too_big` for text over 8,000,000 bytes, or one that
 *   would need more than 64 pieces (text that is mostly quotes or outside
 *   ASCII makes its pieces shorter).
 */
export function planUpload(text: string): UploadPlan {
  const bytes = utf8Bytes(text)
  if (bytes > MAX_UPLOAD_BYTES) {
    throw new StagingFailure('too_big', 'That file is larger than 8 MB. Split it and import in parts.')
  }
  const chunks = splitIntoChunks(text)
  if (chunks.length > MAX_UPLOAD_CHUNKS) {
    throw new StagingFailure('too_big', 'That file cannot be sent in the pieces the server accepts. Split it and import in parts.')
  }
  return { chunks, bytes }
}
