import type { BatchOutcome } from '../repository/BatchOutcome.js'
import type { CommitResult } from './CommitResult.js'

/**
 * Builds the response for a commit that repeated an earlier one.
 *
 * The counters come from the stored batch, so they are the first commit's own.
 * A batch does not store how many rows failed to map, so that count is the
 * repeated request's; the same key sent with the same file gives the same
 * number.
 *
 * @param batch - The batch the key was first recorded on.
 * @param failed - Rows of the repeated request that could not be mapped.
 * @returns The original outcome, marked as replayed.
 */
export function toReplayedResult(batch: BatchOutcome, failed: number): CommitResult {
  return {
    batchId: batch.id,
    imported: batch.rowsImported,
    skipped: batch.rowsSkipped,
    flagged: batch.rowsFlagged,
    failed,
    replayed: true,
  }
}
