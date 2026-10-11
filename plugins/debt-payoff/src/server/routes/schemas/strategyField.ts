import { z } from 'zod'

/** `snowball` (smallest balance first) or `avalanche` (highest rate first). */
export const strategyField = z.enum(['snowball', 'avalanche'], {
  error: 'Choose snowball or avalanche.',
})
