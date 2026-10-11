import { SignJWT, decodeJwt } from 'jose'
import { describe, expect, it } from 'vitest'
import { loadConfig } from '../config.js'
import { signAccessToken, verifyAccessToken } from './tokens.js'
import {
  PLUGIN_TOKEN_MAX_TTL_SECONDS,
  PLUGIN_TOKEN_TTL_SECONDS,
  pluginTokenAudience,
  signPluginToken,
  verifyPluginToken,
  type PluginTokenClaims,
} from './pluginTokens.js'

const SECRET = 'test-secret-that-is-comfortably-long-enough-32'

const config = loadConfig({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://unused@localhost/unused',
  AUTH_SECRET: SECRET,
} as NodeJS.ProcessEnv)

const claims: PluginTokenClaims = {
  sub: '7d4f5c1e-0000-4000-8000-000000000001',
  email: 'someone@example.com',
  sid: '7d4f5c1e-0000-4000-8000-0000000000aa',
  plg: 'wickermoney.insights',
  tbl: { transactions: 'read', categories: 'read' },
}

const key = new TextEncoder().encode(SECRET)

/** Signs a token with an arbitrary payload, to build the malformed ones. */
function craft(
  payload: Record<string, unknown>,
  audience = pluginTokenAudience(config),
  expiresIn: number | string = '5m',
): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuer(config.AUTH_ISSUER)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(key)
}

describe('plugin tokens', () => {
  it('round-trips the plugin, the user, the session and the granted tables', async () => {
    const { token } = await signPluginToken(config, claims)
    expect(await verifyPluginToken(config, token)).toEqual(claims)
  })

  it('lives five minutes by default and reports when it expires', async () => {
    const now = new Date('2026-10-11T12:00:00Z')
    const { expiresAt } = await signPluginToken(config, claims, { now })
    expect(PLUGIN_TOKEN_TTL_SECONDS).toBe(300)
    expect(expiresAt.toISOString()).toBe('2026-10-11T12:05:00.000Z')
  })

  it('gives every token its own id, so two minted in the same second differ', async () => {
    const now = new Date('2026-10-11T12:00:00Z')
    const a = await signPluginToken(config, claims, { now })
    const b = await signPluginToken(config, claims, { now })
    expect(a.token).not.toBe(b.token)
    expect(decodeJwt(a.token).jti).toEqual(expect.any(String))
    expect(decodeJwt(a.token).jti).not.toBe(decodeJwt(b.token).jti)
  })

  it('uses an audience different from the one access tokens use', () => {
    expect(pluginTokenAudience(config)).not.toBe(config.AUTH_AUDIENCE)
    expect(pluginTokenAudience(config)).toBe(`${config.AUTH_AUDIENCE}:plugin`)
  })

  it('is not accepted as an access token', async () => {
    const { token } = await signPluginToken(config, claims)
    expect(await verifyAccessToken(config, token)).toBeNull()
  })

  it('does not accept an access token', async () => {
    const token = await signAccessToken(config, { sub: claims.sub, email: claims.email, sid: claims.sid })
    expect(await verifyPluginToken(config, token)).toBeNull()
  })

  it('rejects an expired token', async () => {
    const now = new Date(Date.now() - 10 * 60 * 1000)
    const { token } = await signPluginToken(config, claims, { now })
    expect(await verifyPluginToken(config, token)).toBeNull()
  })

  it('accepts a token until its last second and not after', async () => {
    const issuedAt = new Date(Date.now() - 4 * 1000)
    const live = await signPluginToken(config, claims, { now: issuedAt, ttlSeconds: 10 })
    expect(await verifyPluginToken(config, live.token)).not.toBeNull()
    const dead = await signPluginToken(config, claims, { now: new Date(Date.now() - 5000), ttlSeconds: 4 })
    expect(await verifyPluginToken(config, dead.token)).toBeNull()
  })

  it('refuses to sign a lifetime outside 1 to 900 seconds', async () => {
    await expect(signPluginToken(config, claims, { ttlSeconds: 0 })).rejects.toThrow(RangeError)
    await expect(signPluginToken(config, claims, { ttlSeconds: PLUGIN_TOKEN_MAX_TTL_SECONDS + 1 })).rejects.toThrow(RangeError)
    await expect(signPluginToken(config, claims, { ttlSeconds: 1.5 })).rejects.toThrow(RangeError)
  })

  it('rejects a token signed with another secret', async () => {
    const other = loadConfig({
      NODE_ENV: 'test', DATABASE_URL: 'postgresql://unused@localhost/unused',
      AUTH_SECRET: 'another-secret-that-is-comfortably-long-enough',
    } as NodeJS.ProcessEnv)
    const { token } = await signPluginToken(other, claims)
    expect(await verifyPluginToken(config, token)).toBeNull()
  })

  it('rejects a token from another issuer', async () => {
    const other = loadConfig({
      NODE_ENV: 'test', DATABASE_URL: 'postgresql://unused@localhost/unused',
      AUTH_SECRET: SECRET, AUTH_ISSUER: 'someone-else',
    } as NodeJS.ProcessEnv)
    const { token } = await signPluginToken(other, claims)
    expect(await verifyPluginToken(config, token)).toBeNull()
  })

  it('rejects an unsigned token and one that names another algorithm', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')
    const body = Buffer.from(JSON.stringify({
      ...claims, iss: config.AUTH_ISSUER, aud: pluginTokenAudience(config),
      iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300,
    })).toString('base64url')
    expect(await verifyPluginToken(config, `${header}.${body}.`)).toBeNull()

    const hs512 = await new SignJWT({ ...claims })
      .setProtectedHeader({ alg: 'HS512' })
      .setIssuer(config.AUTH_ISSUER)
      .setAudience(pluginTokenAudience(config))
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(key)
    expect(await verifyPluginToken(config, hs512)).toBeNull()
  })

  it('rejects garbage', async () => {
    for (const token of ['', 'not-a-jwt', 'a.b.c', 'Bearer x']) {
      expect(await verifyPluginToken(config, token)).toBeNull()
    }
  })

  it('rejects a token with no expiry', async () => {
    const token = await new SignJWT({ email: claims.email, sid: claims.sid, plg: claims.plg, tbl: claims.tbl })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.sub)
      .setIssuer(config.AUTH_ISSUER)
      .setAudience(pluginTokenAudience(config))
      .setIssuedAt()
      .sign(key)
    expect(await verifyPluginToken(config, token)).toBeNull()
  })

  it('rejects a token older than the longest lifetime, even if its expiry is far away', async () => {
    const longAgo = Math.floor(Date.now() / 1000) - 3600
    const token = await new SignJWT({ email: claims.email, sid: claims.sid, plg: claims.plg, tbl: claims.tbl })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.sub)
      .setIssuer(config.AUTH_ISSUER)
      .setAudience(pluginTokenAudience(config))
      .setIssuedAt(longAgo)
      .setExpirationTime(Math.floor(Date.now() / 1000) + 3600)
      .sign(key)
    expect(await verifyPluginToken(config, token)).toBeNull()
  })

  const base = { email: claims.email, sid: claims.sid, plg: claims.plg, tbl: claims.tbl }

  it.each([
    ['no plugin', { ...base, plg: undefined }],
    ['an empty plugin id', { ...base, plg: '' }],
    ['a plugin id that is not a string', { ...base, plg: 7 }],
    ['no session', { ...base, sid: undefined }],
    ['no email', { ...base, email: undefined }],
    ['no grants claim', { ...base, tbl: undefined }],
    ['grants as an array', { ...base, tbl: ['accounts'] }],
    ['grants as a string', { ...base, tbl: 'accounts' }],
    ['a table that does not exist', { ...base, tbl: { passwords: 'read' } }],
    ['a table-shaped key outside the core list', { ...base, tbl: { 'users; drop': 'read' } }],
    ['an access level that is not read or write', { ...base, tbl: { accounts: 'admin' } }],
    ['an access level that is not a string', { ...base, tbl: { accounts: true } }],
  ])('rejects a token with %s', async (_name, payload) => {
    expect(await verifyPluginToken(config, await craft(payload))).toBeNull()
  })

  it('accepts a token with no granted tables', async () => {
    const { token } = await signPluginToken(config, { ...claims, tbl: {} })
    expect(await verifyPluginToken(config, token)).toMatchObject({ plg: claims.plg, tbl: {} })
  })

  it('rejects a well-formed claim set signed for the access-token audience', async () => {
    expect(await verifyPluginToken(config, await craft(base, config.AUTH_AUDIENCE))).toBeNull()
  })
})
