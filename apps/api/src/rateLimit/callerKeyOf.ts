import type { FastifyRequest } from 'fastify'
import { verifyPluginToken } from '../auth/pluginTokens.js'
import { verifyAccessToken } from '../auth/tokens.js'
import type { Config } from '../config.js'

/**
 * Names who a request should be counted against.
 *
 * A bearer token with a valid signature (the host's access token or a plugin
 * token, which is the same user's request made through a plugin) counts against
 * its user: `user:<id>`. Anything else, including a forged or expired token and
 * every request with no token, counts against the client address:
 * `ip:<address>`, which is the forwarded address when `TRUST_PROXY` is set.
 *
 * Only the signature, expiry, issuer and audience are checked here, not the
 * session in the database: this runs before authentication on every request and
 * must not cost a query. A token for a revoked session therefore still names a
 * bucket, but it is refused by the route's own authentication afterwards, and
 * the only counter it can touch is its own user's.
 *
 * @param config - Supplies the signing secret, issuer and audience.
 * @param request - The incoming request.
 * @returns The key suffix.
 */
export async function callerKeyOf(config: Config, request: FastifyRequest): Promise<string> {
  const header = request.headers.authorization
  if (header !== undefined && header.startsWith('Bearer ')) {
    const token = header.slice('Bearer '.length)
    const access = await verifyAccessToken(config, token)
    if (access !== null) return `user:${access.sub}`
    const plugin = await verifyPluginToken(config, token)
    if (plugin !== null) return `user:${plugin.sub}`
  }
  return `ip:${request.ip}`
}
