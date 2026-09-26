import type { AuthUser } from './AuthUser.js'

/** Credentials and identity produced by a successful register, login or refresh. */
export interface AuthSession {
  /** Short-lived signed access token (JWT). */
  readonly accessToken: string
  /** Opaque single-use refresh token; only its hash is stored. Delivered to the client in a cookie, never in a body. */
  readonly refreshToken: string
  /** Access token lifetime in seconds. */
  readonly expiresInSeconds: number
  /** The authenticated user. */
  readonly user: AuthUser
}
