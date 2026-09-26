import type { FastifyReply } from 'fastify'
import type { AuthPolicy } from '../../service/AuthPolicy.js'
import { REFRESH_COOKIE_NAME } from './REFRESH_COOKIE_NAME.js'
import { REFRESH_COOKIE_PATH } from './REFRESH_COOKIE_PATH.js'

/**
 * Expires the refresh-token cookie. Its attributes must match those it was set
 * with, or the browser treats the deletion as a different cookie.
 *
 * @param reply - The response to attach the deletion to.
 * @param policy - Supplies the `Secure` flag.
 */
export function clearRefreshCookie(reply: FastifyReply, policy: AuthPolicy): void {
  void reply.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'strict',
    secure: policy.cookieSecure,
    path: REFRESH_COOKIE_PATH,
  })
}
