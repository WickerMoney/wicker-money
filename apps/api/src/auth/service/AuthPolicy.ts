/** The configured rules the HTTP layer needs to apply around the auth service. */
export interface AuthPolicy {
  /** Whether new accounts may be registered. */
  readonly registrationEnabled: boolean
  /** Refresh-token lifetime in seconds; also the refresh cookie's `Max-Age`. */
  readonly refreshTtlSeconds: number
  /** Whether the refresh cookie carries the `Secure` attribute. */
  readonly cookieSecure: boolean
  /** Requests allowed per client address and window on unauthenticated endpoints. */
  readonly addressRateLimitMax: number
  /** Login and registration attempts allowed per email address and window. */
  readonly emailRateLimitMax: number
  /** Rate-limit window length in seconds. */
  readonly rateLimitWindowSeconds: number
}
