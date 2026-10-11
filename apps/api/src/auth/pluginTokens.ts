import { randomUUID } from 'node:crypto'
import { SignJWT, jwtVerify } from 'jose'
import { CORE_TABLES } from '@wickermoney/plugin-sdk'
import type { Config } from '../config.js'

/** How long a plugin token lives unless a caller says otherwise: five minutes. */
export const PLUGIN_TOKEN_TTL_SECONDS = 300

/** The longest a plugin token may be valid for, however it was signed: fifteen minutes, like an access token. */
export const PLUGIN_TOKEN_MAX_TTL_SECONDS = 900

/** What a plugin may do to a core table. A `write` grant also allows `read`. */
export type PluginGrantAccess = 'read' | 'write'

/** The core tables a plugin token grants, keyed by table name. */
export type PluginTokenGrants = Readonly<Partial<Record<(typeof CORE_TABLES)[number], PluginGrantAccess>>>

/** Claims carried in a plugin token. */
export interface PluginTokenClaims {
  /** Subject: the user the plugin acts for. */
  readonly sub: string
  /** The user's email address, so the request can be attributed the way a host request is. */
  readonly email: string
  /** Session family of the host token it was minted under; ending that session ends this token. */
  readonly sid: string
  /** The plugin's manifest id. The only plugin this token speaks for. */
  readonly plg: string
  /** The core tables the plugin was granted when the token was minted, with their access levels. */
  readonly tbl: PluginTokenGrants
}

/** A signed plugin token and when it stops working. */
export interface SignedPluginToken {
  /** The compact JWT. */
  readonly token: string
  /** When the token expires. */
  readonly expiresAt: Date
}

/** Options for {@link signPluginToken}; both exist so a test can mint a token that is already stale. */
export interface SignPluginTokenOptions {
  /** The time to treat as "now" for `iat` and `exp`. Defaults to the current time. */
  readonly now?: Date
  /** Lifetime in seconds. Defaults to {@link PLUGIN_TOKEN_TTL_SECONDS}. */
  readonly ttlSeconds?: number
}

/** Encodes the shared signing secret as a key for HS256. */
function key(secret: string): Uint8Array {
  return new TextEncoder().encode(secret)
}

/**
 * The audience of plugin tokens: the access-token audience plus `:plugin`.
 *
 * Distinct on purpose. Access tokens are verified against `AUTH_AUDIENCE` and
 * plugin tokens against this value, so neither kind passes the other's check
 * even though both are signed with the same key. A plugin token therefore
 * cannot be presented as a host token, and a host token cannot be presented as
 * a plugin token that names any plugin.
 *
 * @param config - Configuration providing the access-token audience.
 * @returns The plugin-token audience.
 */
export function pluginTokenAudience(config: Config): string {
  return `${config.AUTH_AUDIENCE}:plugin`
}

/**
 * Signs a short-lived token that speaks for one plugin.
 *
 * Same key, issuer and algorithm as an access token, a different audience, and
 * two extra claims: `plg` (the plugin) and `tbl` (its granted core tables). Each
 * token also gets its own `jti`, so two minted in the same second differ and a
 * log line can name one. It
 * is meant for the host's broker to attach to requests it makes on a plugin's
 * behalf, so the server can tell a plugin's request from the host's own without
 * trusting any header.
 *
 * @param config - Configuration providing the secret and issuer.
 * @param claims - Who the plugin acts for, which plugin it is and what it was granted.
 * @param options - Clock and lifetime overrides, for tests.
 * @returns The compact JWT and its expiry.
 * @throws {RangeError} If the lifetime is not between 1 second and {@link PLUGIN_TOKEN_MAX_TTL_SECONDS}.
 */
export async function signPluginToken(
  config: Config,
  claims: PluginTokenClaims,
  options: SignPluginTokenOptions = {},
): Promise<SignedPluginToken> {
  const ttl = options.ttlSeconds ?? PLUGIN_TOKEN_TTL_SECONDS
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > PLUGIN_TOKEN_MAX_TTL_SECONDS) {
    throw new RangeError(`A plugin token lives between 1 and ${PLUGIN_TOKEN_MAX_TTL_SECONDS} seconds.`)
  }
  const issuedAt = Math.floor((options.now ?? new Date()).getTime() / 1000)
  const expiresAtSeconds = issuedAt + ttl
  const token = await new SignJWT({
    email: claims.email,
    sid: claims.sid,
    plg: claims.plg,
    tbl: claims.tbl,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuer(config.AUTH_ISSUER)
    .setAudience(pluginTokenAudience(config))
    .setIssuedAt(issuedAt)
    .setJti(randomUUID())
    .setExpirationTime(expiresAtSeconds)
    .sign(key(config.AUTH_SECRET))
  return { token, expiresAt: new Date(expiresAtSeconds * 1000) }
}

/**
 * Reads a `tbl` claim, accepting only a plain object of known table names and
 * `read` or `write`.
 *
 * Anything else makes the whole token invalid instead of being dropped, so a
 * claim set this host did not write is never partly honoured.
 *
 * @param value - The raw claim.
 * @returns The grants, or `undefined` when the claim is not well formed.
 */
function readGrants(value: unknown): PluginTokenGrants | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const known = new Set<string>(CORE_TABLES)
  const grants: Partial<Record<string, PluginGrantAccess>> = {}
  for (const [table, access] of Object.entries(value)) {
    if (!known.has(table)) return undefined
    if (access !== 'read' && access !== 'write') return undefined
    grants[table] = access
  }
  return grants
}

/**
 * Verifies a plugin token's signature, expiry, issuer, audience and claims.
 *
 * An access token fails here (wrong audience), and so does anything older than
 * {@link PLUGIN_TOKEN_MAX_TTL_SECONDS} or without an expiry.
 *
 * This checks the token only. Whether the session it was minted under is still
 * live, whether the plugin is still enabled and what the plugin's manifest
 * grants today are separate, per-request checks.
 *
 * @param config - Configuration providing the secret, issuer and audience.
 * @param token - Compact JWT.
 * @returns The claims, or `null` for any failure.
 */
export async function verifyPluginToken(
  config: Config,
  token: string,
): Promise<PluginTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key(config.AUTH_SECRET), {
      // Pinned so a token cannot select a weaker or unexpected algorithm.
      algorithms: ['HS256'],
      issuer: config.AUTH_ISSUER,
      audience: pluginTokenAudience(config),
      requiredClaims: ['exp', 'iat', 'sub'],
      maxTokenAge: PLUGIN_TOKEN_MAX_TTL_SECONDS,
    })
    const { email, sid, plg } = payload as Record<string, unknown>
    if (typeof payload.sub !== 'string' || typeof email !== 'string') return null
    if (typeof sid !== 'string' || typeof plg !== 'string' || plg === '') return null
    const tbl = readGrants(payload['tbl'])
    if (tbl === undefined) return null
    return { sub: payload.sub, email, sid, plg, tbl }
  } catch {
    return null
  }
}
