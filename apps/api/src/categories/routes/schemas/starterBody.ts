import { z } from 'zod'
import { isSituation, type Situation } from '../../catalog.js'

/** Request body for creating the starter category set. */
export const starterBody = z.object({
  /**
   * Which circumstances apply. Defaults to the universal set, so a caller that
   * knows nothing about the user still gets a usable vocabulary.
   */
  situations: z
    .array(z.string().refine(isSituation, 'Unknown situation.'))
    .min(1)
    .default(['always'])
    .transform((v) => v as Situation[]),
})
