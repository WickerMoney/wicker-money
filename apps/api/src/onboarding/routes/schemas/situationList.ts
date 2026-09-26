import { z } from 'zod'
import { isSituation, type Situation } from '../../../categories/catalog.js'

/** A list of at most 64 known situation names, typed as `Situation[]`. Rejects any name the catalog does not know. */
export const situationList = z
  .array(z.string().refine(isSituation, 'Unknown situation.'))
  .max(64)
  .transform((v) => v as Situation[])
