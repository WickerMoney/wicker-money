import type { z } from 'zod'
import type { themeContributionSchema } from './themeContributionSchema.js'

/** A colour theme a plugin declares in its manifest's `contributes.themes`: an id, a label, a mode and design tokens. */
export type ThemeContribution = z.infer<typeof themeContributionSchema>
