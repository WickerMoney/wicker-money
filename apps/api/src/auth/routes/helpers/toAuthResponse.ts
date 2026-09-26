import type { AuthSession } from '../../service/AuthSession.js'
import type { AuthResponse } from './AuthResponse.js'

/**
 * Shapes a session for the wire, leaving the refresh token out of the body.
 *
 * @param session - The session produced by the service.
 * @returns The response body.
 */
export function toAuthResponse(session: AuthSession): AuthResponse {
  return {
    accessToken: session.accessToken,
    expiresInSeconds: session.expiresInSeconds,
    user: session.user,
  }
}
