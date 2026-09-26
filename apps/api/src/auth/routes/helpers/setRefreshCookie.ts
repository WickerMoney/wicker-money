import type { FastifyReply } from 'fastify'
import type { AuthPolicy } from '../../service/AuthPolicy.js'
import { REFRESH_COOKIE_NAME } from './REFRESH_COOKIE_NAME.js'
import { REFRESH_COOKIE_PATH } from './REFRESH_COOKIE_PATH.js'

/**
 * Sets the refresh-token cookie: HttpOnly, SameSite=Strict, scoped to the auth
 * endpoints, living as long as the token itself.
 *
 * @param reply - The response to attach the cookie to.
 * @param policy - Supplies the `Secure` flag and the lifetime.
 * @param token - The plaintext refresh token.
 */
export function setRefreshCookie(reply: FastifyReply, policy: AuthPolicy, token: string): void {
  void reply.setCookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: policy.cookieSecure,
    path: REFRESH_COOKIE_PATH,
    maxAge: policy.refreshTtlSeconds,
  })
}
