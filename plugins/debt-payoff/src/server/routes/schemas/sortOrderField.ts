import { z } from 'zod'

/** Where a debt sits in the person's own list: a whole number from 0, lower first. */
export const sortOrderField = z
  .number({ error: 'Send the position as a whole number.' })
  .int('Send the position as a whole number.')
  .min(0, 'The position cannot be negative.')
  .max(1_000_000, 'That position is too large.')
