import type { FastifyInstance } from 'fastify'
import { parseBody } from '../../../http/parseBody.js'
import type { OnboardingService } from '../../service/OnboardingService.js'
import { completeBody } from '../schemas/completeBody.js'

/**
 * Registers `POST /api/v1/onboarding/complete`: finishes setup by creating the
 * starter categories and recording the answers.
 *
 * Idempotent: running it twice adds only what is missing. Responds `200` with
 * the creation result plus `onboarded: true`, and `400` if the body fails
 * validation.
 *
 * @param app - The Fastify instance to register the route on.
 * @param service - The onboarding service.
 */
export function registerCompleteOnboarding(app: FastifyInstance, service: OnboardingService): void {
  app.post('/api/v1/onboarding/complete', async (request) => {
    const user = await app.requireAuth(request)
    const body = parseBody(completeBody, request.body)
    return service.complete(user.id, body.situations)
  })
}
