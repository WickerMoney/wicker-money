import { z } from 'zod'

/** Request body for registering and logging in: an email and a password. */
export const credentials = z.object({
  // Trimmed before validation; the service lower-cases it.
  email: z.string().trim().email().max(320),
  // 12 is above NIST's floor of 8 and cheap to meet with a passphrase.
  password: z.string().min(12, 'Password must be at least 12 characters.').max(1024),
})
