import { z } from 'zod'
import { credentials } from './credentials.js'

/**
 * Request body for registering: the credentials plus, optionally, the
 * browser's time zone. An unrecognised zone is ignored by the service rather
 * than refused here, so a sign-up never fails over a best guess.
 */
export const registerBody = credentials.extend({
  timezone: z.string().max(64).optional(),
})
