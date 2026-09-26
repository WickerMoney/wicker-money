import type { z } from 'zod'
import type { widgetContributionSchema } from './widgetContributionSchema.js'

/** A widget a plugin mounts into a shell slot, as declared in its manifest's `contributes.widgets`. */
export type WidgetContribution = z.infer<typeof widgetContributionSchema>
