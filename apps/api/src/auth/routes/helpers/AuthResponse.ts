import type { AuthUser } from '../../service/AuthUser.js'

/** JSON body returned by register, login and refresh; the refresh token travels in a cookie instead. */
export interface AuthResponse {
  /** Short-lived signed access token (JWT). */
  readonly accessToken: string
  /** Access token lifetime in seconds. */
  readonly expiresInSeconds: number
  /** The authenticated user. */
  readonly user: AuthUser
}
