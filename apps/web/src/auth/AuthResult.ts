import type { CurrentUser } from './CurrentUser.js'

/**
 * The response of the sign-in, register and refresh endpoints.
 *
 * The refresh token is not part of it: the server sets it as an HttpOnly cookie
 * that script cannot read.
 */
export interface AuthResult {
  /** Short-lived bearer token sent with API requests. */
  readonly accessToken: string
  /** The user the token belongs to. */
  readonly user: CurrentUser
}
