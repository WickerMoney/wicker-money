import type { FastifyInstance } from 'fastify'
import type { OnboardingService } from '../../service/OnboardingService.js'

/**
 * Registers `GET /api/v1/onboarding`: whether setup is needed, and the
 * questions to ask.
 *
 * Responds `200` with `{ onboardedAt, situations, categoryCount, groups }`.
 *
 * @param app - The Fastify instance to register the route on.
 * @param service - The onboarding service.
 */
export function registerGetOnboarding(app: FastifyInstance, service: OnboardingService): void {
  app.get('/api/v1/onboarding', async (request) => {
    const user = await app.requireAuth(request)
    return service.getStatus(user.id)
  })
}
