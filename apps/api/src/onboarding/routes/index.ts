import type { FastifyInstance } from 'fastify'
import type { Services } from '../../composition/Services.js'
import { registerCompleteOnboarding } from './handlers/completeOnboarding.js'
import { registerGetOnboarding } from './handlers/getOnboarding.js'
import { registerPreviewOnboarding } from './handlers/previewOnboarding.js'
import { registerResetOnboarding } from './handlers/resetOnboarding.js'

/**
 * Registers the first-run setup endpoints under `/api/v1/onboarding`.
 *
 * @param app - The Fastify instance to register routes on.
 * @param services - The application services.
 */
export function registerOnboardingRoutes(app: FastifyInstance, { onboarding }: Services): void {
  registerGetOnboarding(app, onboarding)
  registerPreviewOnboarding(app, onboarding)
  registerCompleteOnboarding(app, onboarding)
  registerResetOnboarding(app, onboarding)
}
