import type { IndexedTransaction } from './IndexedTransaction.js'
import { sameNormalizedMerchant } from './sameNormalizedMerchant.js'

/**
 * Looks through one bucket of same-amount, same-day transactions for a
 * merchant match that comes earlier in the input than the best found so far.
 *
 * @param bucket - Candidates in input order.
 * @param wanted - The normalised merchant of the file row.
 * @param best - The best match so far, if any.
 * @returns The first candidate with a similar merchant that does not come after `best`, otherwise `best`.
 */
export function earlierMatchInBucket(
  bucket: readonly IndexedTransaction[],
  wanted: string,
  best: IndexedTransaction | undefined,
): IndexedTransaction | undefined {
  for (const candidate of bucket) {
    if (best !== undefined && candidate.order > best.order) break
    if (sameNormalizedMerchant(candidate.merchant, wanted)) return candidate
  }
  return best
}
