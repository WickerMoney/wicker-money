import type { Config } from '../../config.js'
import type { AuthPolicy } from './AuthPolicy.js'

/**
 * Derives the auth policy from configuration.
 *
 * The refresh cookie is `Secure` by default in production, where the API sits
 * behind TLS, and not otherwise, so plain-HTTP local development still works.
 *
 * @param config - Validated configuration.
 * @returns The policy.
 */
export function toAuthPolicy(config: Config): AuthPolicy {
  return {
    registrationEnabled: config.REGISTRATION_ENABLED,
    refreshTtlSeconds: config.AUTH_REFRESH_TTL_SECONDS,
    cookieSecure: config.COOKIE_SECURE === undefined
      ? config.NODE_ENV === 'production'
      : config.COOKIE_SECURE === 'true',
    addressRateLimitMax: config.AUTH_RATE_LIMIT_MAX,
    emailRateLimitMax: config.AUTH_EMAIL_RATE_LIMIT_MAX,
    rateLimitWindowSeconds: config.AUTH_RATE_LIMIT_WINDOW_SECONDS,
  }
}
