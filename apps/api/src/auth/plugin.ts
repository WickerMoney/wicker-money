import type { FastifyInstance, FastifyRequest } from 'fastify'
import { ForbiddenError } from '../core/routes/helpers/ForbiddenError.js'
import { AppError, UnauthorizedError } from '../errors.js'
import type { PluginService } from '../plugins/service/PluginService.js'
import { OwnerRequiredError } from './OwnerRequiredError.js'
import { PluginRouteDeniedError } from './PluginRouteDeniedError.js'
import { grantAllows, grantsOfManifest, intersectGrants } from './pluginGrants.js'
import { pluginRouteAccess } from './pluginRouteAccess.js'
import type { PluginTokenGrants } from './pluginTokens.js'
import type { AuthService } from './service.js'

/** The authenticated user attached to a request. */
export interface RequestUser {
  /** User id (the token's `sub` claim). */
  readonly id: string
  /** User's email address. */
  readonly email: string
  /** The session family the access token was issued under (the token's `sid` claim). */
  readonly sessionFamilyId: string
}

/**
 * Who a plugin token says is calling, once the server has checked it.
 *
 * Present on a request only when the bearer token was a valid plugin token for
 * an enabled plugin, the route is one plugin tokens may reach, and the token's
 * grants cover the route's tables.
 */
export interface PluginPrincipal {
  /** The plugin the token speaks for. */
  readonly pluginId: string
  /** The user the plugin acts for. */
  readonly user: RequestUser
  /**
   * What the plugin may do to core tables: the token's grants narrowed to what
   * the plugin's manifest grants today.
   */
  readonly grants: PluginTokenGrants
}

/** Who made a request: the host application, or a plugin acting for the user. */
export interface RequestActor {
  /** The user the request is for. */
  readonly user: RequestUser
  /** Set when the request came on a plugin token; `undefined` for the host. */
  readonly plugin: PluginPrincipal | undefined
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: RequestUser
    /** Set by the plugin-token hook for a request that arrived on a valid plugin token. */
    pluginPrincipal?: PluginPrincipal
  }
  interface FastifyInstance {
    requireAuth: (request: FastifyRequest) => Promise<RequestUser>
    requireOwner: (request: FastifyRequest) => Promise<RequestUser>
    requireActor: (request: FastifyRequest) => Promise<RequestActor>
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
 * **Plugin tokens.** `requireAuth` and `requireOwner` accept the host's access
 * token only. A plugin token has a different audience and is refused by both,
 * so a route that calls either is closed to plugins without anyone having to
 * say so. The one place plugin tokens are read is the `onRequest` hook added
 * here, which applies the route classification in `pluginRouteAccess.ts`:
 * a plugin token on any route that is not classified as plugin-accessible, or
 * on another plugin's namespace, is refused with `403 plugin_route_denied`
 * before the handler runs. For the routes that are accessible, the hook checks
 * the token's session, that the plugin is still enabled and that its grants
 * (the token's, narrowed to the manifest's) cover what the route needs, then
 * records the result as `request.pluginPrincipal`. `requireActor` hands that
 * back to the few handlers that serve plugins (`requireTableGrant`, the
 * `/api/v1/p/<id>/` routes); everything else keeps using `requireAuth`.
 *
 * Also augments Fastify's types: `request.user` (set once authenticated),
 * `request.pluginPrincipal`, `app.requireAuth(request)`, `app.requireOwner(request)`
 * and `app.requireActor(request)`. The decorators expect an
 * `Authorization: Bearer <token>` header.
 *
 * @param app - Fastify instance to decorate.
 * @param auth - Service used to authenticate access tokens and plugin tokens.
 * @param plugins - The plugin registry, consulted for a plugin token's plugin.
 * @throws {UnauthorizedError} (from the decorators, per request) if the header
 *   is missing or malformed, or the token is invalid, expired or belongs to a
 *   session that was revoked (logout, password change).
 * @throws {OwnerRequiredError} (from `requireOwner`, per request) `403`
 *   `owner_required` if the authenticated account is not an owner.
 * @throws {PluginRouteDeniedError} (from the hook, per request) `403`
 *   `plugin_route_denied` for a plugin token on a route it may not reach.
 */
export function registerAuth(app: FastifyInstance, auth: AuthService, plugins: PluginService): void {
  app.decorate('requireAuth', async (request: FastifyRequest): Promise<RequestUser> => {
    const header = request.headers.authorization
    if (header === undefined || !header.startsWith('Bearer ')) {
      throw new UnauthorizedError()
    }
    const claims = await auth.authenticate(header.slice('Bearer '.length))
    if (claims === null) throw new UnauthorizedError('Access token is invalid or expired.')

    const user: RequestUser = { id: claims.sub, email: claims.email, sessionFamilyId: claims.sid }
    request.user = user
    return user
  })

  app.decorate('requireOwner', async (request: FastifyRequest): Promise<RequestUser> => {
    const user = await app.requireAuth(request)
    if ((await auth.roleOf(user.id)) !== 'owner') throw new OwnerRequiredError()
    return user
  })

  app.decorate('requireActor', async (request: FastifyRequest): Promise<RequestActor> => {
    const plugin = request.pluginPrincipal
    if (plugin !== undefined) {
      request.user = plugin.user
      return { user: plugin.user, plugin }
    }
    return { user: await app.requireAuth(request), plugin: undefined }
  })

  // Default deny for plugin tokens. Runs after routing, so the matched route's
  // registered pattern is known, and before any handler.
  app.addHook('onRequest', async (request: FastifyRequest): Promise<void> => {
    const pattern = request.routeOptions.url
    // Not an API route (health checks, the web app) or no route matched: plugin
    // tokens mean nothing there, and no handler outside /api/v1 reads them.
    if (pattern === undefined || !pattern.startsWith('/api/v1/')) return
    const header = request.headers.authorization
    if (header === undefined || !header.startsWith('Bearer ')) return

    const claims = await auth.authenticatePlugin(header.slice('Bearer '.length))
    // Not a plugin token, or an expired or revoked one: leave it to `requireAuth`,
    // which refuses it (an access token passes there; a plugin token never does).
    if (claims === null) return

    const access = pluginRouteAccess(request.method, pattern)
    if (access.kind === 'denied') throw new PluginRouteDeniedError()
    if (access.kind === 'plugin-namespace' && access.pluginId !== claims.plg) {
      throw new PluginRouteDeniedError('This route belongs to another plugin.')
    }

    const plugin = await plugins.findEnabled(claims.plg)
    if (plugin === undefined) {
      throw new AppError(`Plugin '${claims.plg}' is not installed or not enabled.`, 403, 'plugin_disabled')
    }

    // A token can never do more than the manifest says today, whatever it was minted with.
    const grants = intersectGrants(claims.tbl, grantsOfManifest(plugin.manifest))
    if (access.kind === 'core') {
      for (const { table, access: level } of access.needs) {
        if (!grantAllows(grants, table, level)) {
          throw new ForbiddenError(
            `Plugin '${claims.plg}' was not granted ${level} access to '${table}'. ` +
              `Add it to requiredTables in the manifest.`,
          )
        }
      }
    }

    request.pluginPrincipal = {
      pluginId: claims.plg,
      user: { id: claims.sub, email: claims.email, sessionFamilyId: claims.sid },
      grants,
    }
  })
}
