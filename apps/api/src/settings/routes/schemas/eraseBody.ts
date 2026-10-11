import { z } from 'zod'

/**
 * Request body for erasing the signed-in user's own data: the password again,
 * and the phrase typed to confirm. Whether the phrase is the right one is the
 * service's call, so the failure lands on the `confirmation` field.
 */
export const eraseMyDataBody = z.object({
  password: z.string().min(1, 'Enter your password.').max(1024),
  confirmation: z.string().max(200).default(''),
})

/** Request body for erasing the whole instance: the same two fields and an acknowledgement of other live sessions. */
export const eraseInstanceBody = eraseMyDataBody.extend({
  acknowledgeActiveSessions: z.boolean().default(false),
})
