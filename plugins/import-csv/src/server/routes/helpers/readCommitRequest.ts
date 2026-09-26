import type { CommitInput } from '../../service/CommitInput.js'
import type { CommitBody } from './CommitBody.js'
import { readAnalyzeRequest } from './readAnalyzeRequest.js'
import { readIdempotencyKey } from './readIdempotencyKey.js'

/**
 * Validates a commit request body.
 *
 * `acceptRowNumbers` absent means "none": a flagged row is never imported by
 * default. A missing `fileName` becomes `upload.csv`, and a long one is cut to
 * the column width.
 *
 * @param body - The parsed JSON body, unvalidated.
 * @returns The analyze fields plus the file name, the accepted row numbers and, when sent, the idempotency key.
 * @throws {ImportError} `400` for an invalid account id, mapping, CSV or idempotency key.
 */
export function readCommitRequest(body: unknown): CommitInput {
  const b = (body ?? {}) as CommitBody
  const idempotencyKey = readIdempotencyKey(b.idempotencyKey)
  return {
    ...readAnalyzeRequest(b),
    fileName: typeof b.fileName === 'string' ? b.fileName.slice(0, 300) : 'upload.csv',
    acceptRowNumbers: Array.isArray(b.acceptRowNumbers)
      ? b.acceptRowNumbers.filter((n): n is number => typeof n === 'number')
      : [],
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
  }
}
