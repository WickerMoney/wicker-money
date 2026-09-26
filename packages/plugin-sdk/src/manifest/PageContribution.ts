import type { z } from 'zod'
import type { pageContributionSchema } from './pageContributionSchema.js'

/** A page a plugin adds to the shell, as declared in its manifest's `contributes.pages`. */
export type PageContribution = z.infer<typeof pageContributionSchema>
