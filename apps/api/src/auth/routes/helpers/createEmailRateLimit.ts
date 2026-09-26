import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { AuthPolicy } from '../../service/AuthPolicy.js'
import { emailKeyOf } from './emailKeyOf.js'
import { rateLimitedError } from './rateLimitedError.js'

/**
 * Builds a `preHandler` that limits attempts per email address, however many
 * client addresses they come from, so one account cannot be guessed at by a
 * distributed attacker. Runs after body parsing; a body with no readable email
 * passes through to validation, which rejects it.
 *
 * @param app - Instance with `@fastify/rate-limit` registered.
 * @param policy - Supplies the attempt count and window.
 * @param scope - Names the endpoint, so login and registration attempts are counted separately.
 * @returns The hook.
 * @throws From the hook: an `AppError` with code `rate_limited` (429) once the limit is exceeded.
 */
export function createEmailRateLimit(
  app: FastifyInstance,
  policy: AuthPolicy,
  scope: string,
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  const check = app.createRateLimit({
    max: policy.emailRateLimitMax,
    timeWindow: policy.rateLimitWindowSeconds * 1000,
    keyGenerator: (request) => `${scope}:${emailKeyOf(request.body)}`,
  })

  return async (request, reply) => {
    if (emailKeyOf(request.body) === '') return
    const result = await check(request)
    if (!result.isAllowed && result.isExceeded) {
      void reply.header('retry-after', String(result.ttlInSeconds))
      throw rateLimitedError()
    }
  }
}
