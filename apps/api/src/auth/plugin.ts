import type { FastifyInstance, FastifyRequest } from 'fastify'
import { UnauthorizedError } from '../errors.js'
import { OwnerRequiredError } from './OwnerRequiredError.js'
import type { AuthService } from './service.js'

/** The authenticated user attached to a request. */
export interface RequestUser {
  /** User id (the token's `sub` claim). */
  readonly id: string
  /** User's email address. */
  readonly email: string
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: RequestUser
  }
  interface FastifyInstance {
    requireAuth: (request: FastifyRequest) => Promise<RequestUser>
    requireOwner: (request: FastifyRequest) => Promise<RequestUser>
  }
}

/**
 * Attaches `requireAuth`, which resolves the bearer token to a user or throws.
 *
 * Beyond checking the token's signature and expiry, it confirms the session the
 * token was issued under is still live, so logging out or changing the password
 * takes effect at once instead of when the access token would have expired.
 *
 * Handlers call it explicitly rather than relying on a global hook: a route
 * that forgets is then a compile-time-visible omission in that handler, not an
 * invisible hole opened by a missing decorator elsewhere.
 *
 * Also attaches `requireOwner`, for instance-wide administration (which
 * plugins are enabled, for example). It authenticates exactly as
 * `requireAuth` does and then reads the account's role from the database on
 * every call. The role is deliberately not a token claim: demoting an owner
 * takes effect on their next request, not when their token expires.
 *
 * Also augments Fastify's types: `request.user` (set once authenticated),
 * `app.requireAuth(request)` and `app.requireOwner(request)`. The decorator expects an
 * `Authorization: Bearer <access token>` header and, on success, sets
 * `request.user` and returns it.
 *
 * @param app - Fastify instance to decorate.
 * @param auth - Service used to authenticate access tokens.
 * @throws {UnauthorizedError} (from the decorator, per request) if the header
 *   is missing or malformed, or the token is invalid, expired or belongs to a
 *   session that was revoked (logout, password change).
 * @throws {OwnerRequiredError} (from `requireOwner`, per request) `403`
 *   `owner_required` if the authenticated account is not an owner.
 */
export function registerAuth(app: FastifyInstance, auth: AuthService): void {
  app.decorate('requireAuth', async (request: FastifyRequest): Promise<RequestUser> => {
    const header = request.headers.authorization
    if (header === undefined || !header.startsWith('Bearer ')) {
      throw new UnauthorizedError()
    }
    const claims = await auth.authenticate(header.slice('Bearer '.length))
    if (claims === null) throw new UnauthorizedError('Access token is invalid or expired.')

    const user: RequestUser = { id: claims.sub, email: claims.email }
    request.user = user
    return user
  })

  app.decorate('requireOwner', async (request: FastifyRequest): Promise<RequestUser> => {
    const user = await app.requireAuth(request)
    if ((await auth.roleOf(user.id)) !== 'owner') throw new OwnerRequiredError()
    return user
  })
}
