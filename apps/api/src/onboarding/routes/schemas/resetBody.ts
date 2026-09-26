import { z } from 'zod'

/** Request body for resetting setup. */
export const resetBody = z.object({
  /**
   * Whether to also delete the starter categories, so the next run starts from
   * nothing. Off by default: a reset that silently removed a year of
   * categorization would be the single most destructive button in the app.
   * Even when on, only unused starter categories are removed.
   */
  removeCategories: z.boolean().default(false),
})
