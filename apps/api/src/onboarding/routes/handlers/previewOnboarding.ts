import type { FastifyInstance } from 'fastify'
import { parseBody } from '../../../http/parseBody.js'
import type { OnboardingService } from '../../service/OnboardingService.js'
import { completeBody } from '../schemas/completeBody.js'

/**
 * Registers `POST /api/v1/onboarding/preview`: counts what a set of answers
 * would create, without creating it.
 *
 * Responds `200` with `{ total, parents, slugs }`, and `400` if the body fails
 * validation.
 *
 * @param app - The Fastify instance to register the route on.
 * @param service - The onboarding service.
 */
export function registerPreviewOnboarding(app: FastifyInstance, service: OnboardingService): void {
  app.post('/api/v1/onboarding/preview', async (request) => {
    await app.requireAuth(request)
    const body = parseBody(completeBody, request.body)
    return service.preview(body.situations)
  })
}
