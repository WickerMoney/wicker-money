import { z } from 'zod'

/** Request body for switching a plugin on or off. */
export const setPluginEnabledBody = z.object({
  enabled: z.boolean(),
}).strict()
