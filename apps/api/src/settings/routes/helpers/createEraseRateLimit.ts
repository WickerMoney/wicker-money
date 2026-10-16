import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { AuthPolicy } from '../../../auth/service/AuthPolicy.js'
import { rateLimitedError } from '../../../auth/routes/helpers/rateLimitedError.js'

/**
 * Builds a check that limits how often one signed-in user can try the
 * actions that ask for the password again (the danger-zone erases and the
 * export ticket): a stolen access token must not become a way to guess the
 * password at full speed, and sharing one counter means three routes do not
 * triple the guesses. Keyed on the user,
 * not the address, so it holds however many addresses the guesses come from.
 * Every attempt counts, successful or not; there is no reason to erase or
 * export more than a few times a minute. Uses the per-email auth limit and window, so an
 * operator tunes one pair of settings for both.
 *
 * @param app - Instance with `@fastify/rate-limit` registered.
 * @param policy - Supplies the attempt count and window.
 * @returns The check; call it after authenticating, so `request.user` is set.
 * @throws From the check: an `AppError` with code `rate_limited` (429) once the limit is exceeded.
 */
export function createEraseRateLimit(
  app: FastifyInstance,
  policy: AuthPolicy,
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  const check = app.createRateLimit({
    max: policy.emailRateLimitMax,
    timeWindow: policy.rateLimitWindowSeconds * 1000,
    keyGenerator: (request) => `erase:${request.user?.id ?? request.ip}`,
  })

  return async (request, reply) => {
    const result = await check(request)
    if (!result.isAllowed && result.isExceeded) {
      void reply.header('retry-after', String(result.ttlInSeconds))
      throw rateLimitedError()
    }
  }
}
