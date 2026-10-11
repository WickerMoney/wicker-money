import { z } from 'zod'

/** What a person calls a debt: 1 to 100 characters once trimmed. */
export const nameField = z
  .string({ error: 'Enter a name.' })
  .trim()
  .min(1, 'Enter a name.')
  .max(100, 'Use 100 characters or fewer.')
