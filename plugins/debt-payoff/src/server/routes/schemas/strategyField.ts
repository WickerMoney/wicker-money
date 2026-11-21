import { z } from 'zod'
import type { Strategy } from '../../../shared/index.js'

const CHOICES = ['snowball', 'avalanche', 'custom'] as const satisfies readonly Strategy[]

/** `snowball` (smallest balance first), `avalanche` (highest rate first) or `custom` (the person's own order). */
export const strategyField = z.enum(CHOICES, {
  error: 'Choose snowball, avalanche or custom.',
})
