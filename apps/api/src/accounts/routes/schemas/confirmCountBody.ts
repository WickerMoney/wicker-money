import { z } from 'zod'

/** Request body carrying the caller's confirmation of how many rows an action will affect. */
export const confirmCountBody = z.object({
  /**
   * The count the caller saw right before confirming, as an
   * optimistic-concurrency guard. If it no longer matches -- an import ran in
   * the meantime, say -- the action is refused rather than silently acting on
   * more (or fewer) rows than the user agreed to.
   */
  confirmCount: z.number().int().min(0),
})
