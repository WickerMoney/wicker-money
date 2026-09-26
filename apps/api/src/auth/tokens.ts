import { createHash, randomBytes } from 'node:crypto'
import { SignJWT, jwtVerify } from 'jose'
import type { Config } from '../config.js'

/** Claims carried in an access token. */
export interface AccessClaims {
  /** Subject: the user id. */
  readonly sub: string
  /** User's email address. */
  readonly email: string
  /** Session family the token was issued under; revoking the family revokes the token. */
  readonly sid: string
}

/** Encodes the shared signing secret as a key for HS256. */
function key(secret: string): Uint8Array {
  return new TextEncoder().encode(secret)
}

/**
 * Signs a short-lived access token (JWT, HS256) carrying the user's id, email and session family.
 *
 * Issuer, audience and lifetime come from configuration.
 *
 * @param config - Configuration providing the secret, issuer, audience and TTL.
 * @param claims - User id, email and session family to embed.
 * @returns The compact JWT.
 */
export async function signAccessToken(config: Config, claims: AccessClaims): Promise<string> {
  return new SignJWT({ email: claims.email, sid: claims.sid })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuer(config.AUTH_ISSUER)
    .setAudience(config.AUTH_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${config.AUTH_ACCESS_TTL_SECONDS}s`)
    .sign(key(config.AUTH_SECRET))
}

/**
 * Verifies an access token's signature, expiry, issuer and audience.
 *
 * @param config - Configuration providing the secret, issuer and audience.
 * @param token - Compact JWT.
 * @returns The claims, or `null` for any failure (invalid, expired, wrong issuer or audience, missing `sub`, `email` or `sid` claims).
 */
export async function verifyAccessToken(
  config: Config,
  token: string,
): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key(config.AUTH_SECRET), {
      // Pinned so a token cannot select a weaker or unexpected algorithm.
      algorithms: ['HS256'],
      issuer: config.AUTH_ISSUER,
      audience: config.AUTH_AUDIENCE,
    })
    const sid = payload['sid']
    if (typeof payload.sub !== 'string' || typeof payload['email'] !== 'string') return null
    if (typeof sid !== 'string') return null
    return { sub: payload.sub, email: payload['email'], sid }
  } catch {
    return null
  }
}

/**
 * Refresh tokens are opaque random strings, not JWTs — they must be revocable,
 * and a self-contained token cannot be. Only the SHA-256 digest is persisted,
 * so a database disclosure does not yield usable credentials.
 *
 * @returns The token to give the client (256 random bits, base64url) and the
 *   hash to persist.
 */
export function generateRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: hashRefreshToken(token) }
}

/**
 * Computes the storage digest of a refresh token.
 *
 * @param token - Refresh token as given to the client.
 * @returns Lowercase hex SHA-256 digest (64 characters).
 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
