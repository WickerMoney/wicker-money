import type { FastifyInstance } from 'fastify'
import { parseBody } from '../../../http/parseBody.js'
import type { OnboardingService } from '../../service/OnboardingService.js'
import { resetBody } from '../schemas/resetBody.js'

/**
 * Registers `POST /api/v1/onboarding/reset`: puts the account back to its
 * pre-setup state.
 *
 * Exists so the wizard can be tried again, for anyone whose circumstances
 * changed enough that re-answering beats editing twenty categories by hand.
 * Responds `200` with `{ onboarded: false, removed, kept }`, and `400` if the
 * body fails validation.
 *
 * @param app - The Fastify instance to register the route on.
 * @param service - The onboarding service.
 */
export function registerResetOnboarding(app: FastifyInstance, service: OnboardingService): void {
  app.post('/api/v1/onboarding/reset', async (request) => {
    const user = await app.requireAuth(request)
    const body = parseBody(resetBody, request.body)
    return service.reset(user.id, body.removeCategories)
  })
}
