import type { AuthPolicy } from '../../service/AuthPolicy.js'

/**
 * Per-client-address limit for a route's `config.rateLimit`, keyed on the
 * request's IP (the forwarded address when the server trusts its proxy).
 *
 * @param policy - Supplies the request count and window.
 * @returns Options for `@fastify/rate-limit`.
 */
export function addressRateLimit(policy: AuthPolicy): { max: number; timeWindow: number } {
  return {
    max: policy.addressRateLimitMax,
    timeWindow: policy.rateLimitWindowSeconds * 1000,
  }
}
