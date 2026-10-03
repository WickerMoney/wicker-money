import { randomUUID } from 'node:crypto'
import type { LightMyRequestResponse } from 'fastify'
import { SignJWT, decodeJwt } from 'jose'
import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../app.js'
import type { Config } from '../config.js'
import { KyselyUnitOfWork } from '../data/KyselyUnitOfWork.js'
import { asUser } from '../db/client.js'
import {
  auth,
  createHarness,
  createUser,
  type Harness,
  type TestUser,
} from '../testing/harness.js'
import { REFRESH_COOKIE_NAME } from './routes/helpers/REFRESH_COOKIE_NAME.js'
import { AuthService } from './service.js'

const PASSWORD = 'correct-horse-battery-staple'
const CSRF = { 'x-wickermoney-csrf': '1' }

let h: Harness
beforeAll(async () => { h = await createHarness() })
afterAll(async () => { await h.close() })

/** Posts to the refresh endpoint carrying `token` as the refresh cookie. */
function refresh(
  token: string | undefined,
  headers: Record<string, string> = CSRF,
  app = h.app,
): Promise<LightMyRequestResponse> {
  return app.inject({
    method: 'POST',
    url: '/api/v1/auth/refresh',
    headers: { ...headers, ...(token === undefined ? {} : { cookie: `${REFRESH_COOKIE_NAME}=${token}` }) },
  })
}

/** Posts to the logout endpoint carrying `token` as the refresh cookie. */
function logout(token: string | undefined, headers: Record<string, string> = CSRF) {
  return h.app.inject({
    method: 'POST',
    url: '/api/v1/auth/logout',
    headers: { ...headers, ...(token === undefined ? {} : { cookie: `${REFRESH_COOKIE_NAME}=${token}` }) },
  })
}

/** Logs in over HTTP. */
function login(email: string, password = PASSWORD) {
  return h.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } })
}

/** Requests `/auth/me` with a raw bearer token. */
function me(accessToken: string) {
  return h.app.inject({
    method: 'GET',
    url: '/api/v1/auth/me',
    headers: { authorization: `Bearer ${accessToken}` },
  })
}

/** The refresh token a response set in its cookie. */
function cookieToken(res: LightMyRequestResponse): string {
  const cookie = res.cookies.find((c) => c.name === REFRESH_COOKIE_NAME)
  if (cookie === undefined) throw new Error('no refresh cookie in response')
  return cookie.value
}

describe('registration', () => {
  it('creates a user and returns a usable token pair', async () => {
    const user = await createUser(h)
    expect(user.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(user.accessToken.split('.')).toHaveLength(3)
    expect(user.refreshToken.length).toBeGreaterThan(20)
    expect((await me(user.accessToken)).statusCode).toBe(200)
  })

  it('keeps the refresh token out of the response body', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: `body-${randomUUID()}@example.com`, password: PASSWORD },
    })
    expect(res.statusCode).toBe(201)
    expect(Object.keys(res.json()).sort()).toEqual(['accessToken', 'expiresInSeconds', 'user'])
    expect(res.body).not.toContain(cookieToken(res))
  })

  it('rejects a duplicate email with 409 email_taken', async () => {
    const user = await createUser(h)
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: user.email, password: PASSWORD },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().code).toBe('email_taken')
  })

  it('rejects a short password', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'short@example.com', password: 'tooshort' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('normalises email case and surrounding whitespace', async () => {
    const local = `Mixed.Case-${randomUUID()}`
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: `  ${local}@Example.COM  `, password: PASSWORD },
    })
    expect(res.statusCode).toBe(201)
    const stored = `${local}@example.com`.toLowerCase()
    expect(res.json().user.email).toBe(stored)

    // Every spelling signs into the same account...
    for (const spelling of [stored, stored.toUpperCase(), ` ${stored}\t`]) {
      const ok = await login(spelling)
      expect(ok.statusCode).toBe(200)
      expect(ok.json().user.id).toBe(res.json().user.id)
    }
    // ...and cannot be registered a second time.
    const dup = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: stored.toUpperCase(), password: PASSWORD },
    })
    expect(dup.statusCode).toBe(409)
  })
})

describe('login', () => {
  it('accepts correct credentials', async () => {
    const user = await createUser(h)
    expect((await login(user.email)).statusCode).toBe(200)
  })

  it('rejects a wrong password', async () => {
    const user = await createUser(h)
    expect((await login(user.email, 'wrong-password-entirely')).statusCode).toBe(401)
  })

  it('gives an unknown email the same response as a wrong password', async () => {
    const res = await login('nobody@example.com', 'wrong-password-entirely')
    expect(res.statusCode).toBe(401)
    // Identical body: nothing here reveals whether the address is registered.
    expect(res.json().message).toBe('Email or password is incorrect.')
  })
})

describe('refresh cookie', () => {
  it('is HttpOnly, SameSite=Strict, scoped to the auth path and lives as long as the token', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: `cookie-${randomUUID()}@example.com`, password: PASSWORD },
    })
    const cookie = res.cookies.find((c) => c.name === 'wickermoney_refresh')
    expect(cookie).toMatchObject({
      httpOnly: true,
      sameSite: 'Strict',
      path: '/api/v1/auth',
      maxAge: h.config.AUTH_REFRESH_TTL_SECONDS,
    })
    // NODE_ENV=test, so Secure defaults off; plain HTTP would drop it otherwise.
    expect(cookie?.secure).not.toBe(true)
  })

  it('carries Secure when COOKIE_SECURE=true', async () => {
    const config: Config = { ...h.config, COOKIE_SECURE: 'true' }
    const app = buildApp({ db: h.db, config })
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { email: `secure-${randomUUID()}@example.com`, password: PASSWORD },
      })
      expect(res.cookies.find((c) => c.name === 'wickermoney_refresh')?.secure).toBe(true)
    } finally {
      await app.close()
    }
  })

  it('is Secure by default in production and not otherwise', async () => {
    const { toAuthPolicy } = await import('./service/toAuthPolicy.js')
    expect(toAuthPolicy({ ...h.config, NODE_ENV: 'production' }).cookieSecure).toBe(true)
    expect(toAuthPolicy({ ...h.config, NODE_ENV: 'development' }).cookieSecure).toBe(false)
    expect(
      toAuthPolicy({ ...h.config, NODE_ENV: 'production', COOKIE_SECURE: 'false' }).cookieSecure,
    ).toBe(false)
  })
})

describe('refresh rotation', () => {
  it('issues a new pair, sets a new cookie and revokes the presented token', async () => {
    const user = await createUser(h)
    const first = await refresh(user.refreshToken)
    expect(first.statusCode).toBe(200)
    expect(first.json().refreshToken).toBeUndefined()
    expect(first.json().user.id).toBe(user.id)
    expect(cookieToken(first)).not.toBe(user.refreshToken)
    expect((await me(first.json().accessToken)).statusCode).toBe(200)

    const next = await refresh(cookieToken(first))
    expect(next.statusCode).toBe(200)
  })

  it('requires the anti-CSRF header', async () => {
    const user = await createUser(h)
    for (const headers of [{}, { 'x-wickermoney-csrf': '0' }]) {
      const res = await refresh(user.refreshToken, headers)
      expect(res.statusCode).toBe(403)
      expect(res.json().code).toBe('csrf_required')
    }
    // Refused before touching the token, so it still works.
    expect((await refresh(user.refreshToken)).statusCode).toBe(200)
  })

  it('rejects a missing cookie with 401 and clears it', async () => {
    const res = await refresh(undefined)
    expect(res.statusCode).toBe(401)
    const cleared = res.cookies.find((c) => c.name === REFRESH_COOKIE_NAME)
    expect(cleared?.value).toBe('')
    expect(cleared?.path).toBe('/api/v1/auth')
  })

  it('rejects an unknown token with 401 and clears the cookie', async () => {
    const res = await refresh('not-a-token-we-issued')
    expect(res.statusCode).toBe(401)
    expect(res.cookies.find((c) => c.name === REFRESH_COOKIE_NAME)?.value).toBe('')
  })

  it('rejects an expired token', async () => {
    const user = await createUser(h)
    await asUser(h.db, user.id, (trx) =>
      sql`UPDATE core.sessions SET expires_at = now() - interval '1 minute' WHERE user_id = ${user.id}`.execute(trx),
    )
    expect((await refresh(user.refreshToken)).statusCode).toBe(401)
  })

  it('treats reuse of a rotated token as theft and revokes the whole family', async () => {
    const user = await createUser(h)
    const rotated = await refresh(user.refreshToken)
    expect(rotated.statusCode).toBe(200)
    const successor = cookieToken(rotated)

    // The original was already spent: presenting it again is a replay.
    const replay = await refresh(user.refreshToken)
    expect(replay.statusCode).toBe(401)

    // The legitimate successor and its access token die with the family.
    expect((await refresh(successor)).statusCode).toBe(401)
    expect((await me(rotated.json().accessToken)).statusCode).toBe(401)
  })

  it('leaves other logins of the same user alone when one family is revoked', async () => {
    const user = await createUser(h)
    const other = await login(user.email)
    expect((await refresh(user.refreshToken)).statusCode).toBe(200)
    expect((await refresh(user.refreshToken)).statusCode).toBe(401) // replay: the first login's family dies
    expect((await refresh(cookieToken(other))).statusCode).toBe(200)
  })

  it('lets exactly one of several concurrent refreshes with the same token succeed', async () => {
    const user = await createUser(h)
    const results = await Promise.all(
      Array.from({ length: 6 }, () => refresh(user.refreshToken)),
    )
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1)
    expect(results.filter((r) => r.statusCode === 401)).toHaveLength(5)
  })

  it('rejects a cross-origin refresh', async () => {
    const user = await createUser(h)
    const res = await refresh(user.refreshToken, { ...CSRF, origin: 'https://evil.example' })
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('origin_mismatch')
  })

  it('accepts an Origin that matches the request host', async () => {
    const user = await createUser(h)
    const res = await refresh(user.refreshToken, {
      ...CSRF,
      host: 'wickermoney.test',
      origin: 'https://wickermoney.test',
    })
    expect(res.statusCode).toBe(200)
  })
})

describe('logout', () => {
  it('revokes the session at once, access token included, and clears the cookie', async () => {
    const user = await createUser(h)
    expect((await me(user.accessToken)).statusCode).toBe(200)

    const res = await logout(user.refreshToken)
    expect(res.statusCode).toBe(204)
    expect(res.cookies.find((c) => c.name === REFRESH_COOKIE_NAME)?.value).toBe('')

    expect((await me(user.accessToken)).statusCode).toBe(401)
    expect((await refresh(user.refreshToken)).statusCode).toBe(401)
  })

  it('ends the whole family, including a rotated successor', async () => {
    const user = await createUser(h)
    const rotated = await refresh(user.refreshToken)
    await logout(cookieToken(rotated))
    expect((await me(rotated.json().accessToken)).statusCode).toBe(401)
    // The pre-rotation access token belonged to the same session.
    expect((await me(user.accessToken)).statusCode).toBe(401)
  })

  it('does not end the user\'s other sessions', async () => {
    const user = await createUser(h)
    const other = await login(user.email)
    await logout(user.refreshToken)
    expect((await me(other.json().accessToken)).statusCode).toBe(200)
  })

  it('requires the anti-CSRF header', async () => {
    const user = await createUser(h)
    const res = await logout(user.refreshToken, {})
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('csrf_required')
    expect((await me(user.accessToken)).statusCode).toBe(200)
  })

  it('is idempotent without a cookie', async () => {
    const res = await logout(undefined)
    expect(res.statusCode).toBe(204)
  })
})

describe('access control', () => {
  it('refuses an unauthenticated request', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/accounts' })
    expect(res.statusCode).toBe(401)
  })

  it('refuses a malformed token', async () => {
    expect((await me('not-a-real-token')).statusCode).toBe(401)
  })

  it('identifies the caller', async () => {
    const user = await createUser(h)
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth(user) })
    expect(res.json()).toEqual({ id: user.id, email: user.email, timezone: 'UTC' })
  })
})

describe('time zone', () => {
  const patchMe = (user: TestUser, payload: unknown) =>
    h.app.inject({ method: 'PATCH', url: '/api/v1/auth/me', headers: auth(user), payload: payload as object })

  it('takes a recognised browser zone at registration', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: `tz-${randomUUID()}@example.com`, password: PASSWORD, timezone: 'America/Denver' },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().user.timezone).toBe('America/Denver')
  })

  it('keeps UTC when registration names a zone the server does not know', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: `tz-${randomUUID()}@example.com`, password: PASSWORD, timezone: 'Mars/Olympus' },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().user.timezone).toBe('UTC')
  })

  it('updates the zone, canonically spelled, and the next refresh reports it', async () => {
    const user = await createUser(h)
    const res = await patchMe(user, { timezone: 'us/pacific' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ id: user.id, email: user.email, timezone: 'America/Los_Angeles' })
    expect((await me(user.accessToken)).json().timezone).toBe('America/Los_Angeles')
    const rotated = await refresh(user.refreshToken)
    expect(rotated.json().user.timezone).toBe('America/Los_Angeles')
  })

  it('moves "today" for recurring items with it', async () => {
    const user = await createUser(h)
    // UTC+14 and UTC-11 are 25 hours apart, so at any instant Kiritimati's
    // date is one or two days ahead of Pago Pago's.
    await patchMe(user, { timezone: 'Pacific/Kiritimati' })
    const ahead = (await h.app.inject({ method: 'GET', url: '/api/v1/recurring-items', headers: auth(user) })).json().today as string
    await patchMe(user, { timezone: 'Pacific/Pago_Pago' })
    const behind = (await h.app.inject({ method: 'GET', url: '/api/v1/recurring-items', headers: auth(user) })).json().today as string
    const days = (Date.parse(ahead) - Date.parse(behind)) / 86_400_000
    expect(days).toBeGreaterThanOrEqual(1)
    expect(days).toBeLessThanOrEqual(2)
  })

  it.each([
    [{ timezone: 'Nowhere/Special' }],
    [{ timezone: '+02:00' }],
    [{ timezone: '' }],
    [{}],
    [{ timezone: 'UTC', email: 'someone-else@example.com' }],
  ])('refuses %j with 400 and changes nothing', async (payload) => {
    const user = await createUser(h)
    const res = await patchMe(user, payload)
    expect(res.statusCode).toBe(400)
    expect((await me(user.accessToken)).json().timezone).toBe('UTC')
  })

  it('needs a signed-in user', async () => {
    const res = await h.app.inject({ method: 'PATCH', url: '/api/v1/auth/me', payload: { timezone: 'UTC' } })
    expect(res.statusCode).toBe(401)
  })
})

describe('access token validation', () => {
  /** Signs a token that is valid except for whatever `overrides` change. */
  async function forge(
    user: TestUser,
    overrides: {
      secret?: string
      issuer?: string
      audience?: string
      expiresAt?: number
      sid?: string | null
    } = {},
  ): Promise<string> {
    const sid = overrides.sid === undefined ? decodeJwt(user.accessToken)['sid'] : overrides.sid
    const claims: Record<string, unknown> = { email: user.email }
    if (sid !== null) claims['sid'] = sid
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setIssuer(overrides.issuer ?? h.config.AUTH_ISSUER)
      .setAudience(overrides.audience ?? h.config.AUTH_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(overrides.expiresAt ?? Math.floor(Date.now() / 1000) + 600)
      .sign(new TextEncoder().encode(overrides.secret ?? h.config.AUTH_SECRET))
  }

  it('accepts a correctly forged token (control for the cases below)', async () => {
    const user = await createUser(h)
    expect((await me(await forge(user))).statusCode).toBe(200)
  })

  it('rejects an expired token', async () => {
    const user = await createUser(h)
    const token = await forge(user, { expiresAt: Math.floor(Date.now() / 1000) - 60 })
    expect((await me(token)).statusCode).toBe(401)
  })

  it('rejects the wrong issuer', async () => {
    const user = await createUser(h)
    expect((await me(await forge(user, { issuer: 'someone-else' }))).statusCode).toBe(401)
  })

  it('rejects the wrong audience', async () => {
    const user = await createUser(h)
    expect((await me(await forge(user, { audience: 'someone-else' }))).statusCode).toBe(401)
  })

  it('rejects a token signed with another secret', async () => {
    const user = await createUser(h)
    const token = await forge(user, { secret: 'another-secret-that-is-long-enough-too' })
    expect((await me(token)).statusCode).toBe(401)
  })

  it('rejects a tampered payload', async () => {
    const user = await createUser(h)
    const [header, payload, signature] = user.accessToken.split('.') as [string, string, string]
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Record<string, unknown>
    claims['sub'] = randomUUID()
    const forged = Buffer.from(JSON.stringify(claims)).toString('base64url')
    expect((await me(`${header}.${forged}.${signature}`)).statusCode).toBe(401)
  })

  it('rejects an unsigned (alg none) token', async () => {
    const user = await createUser(h)
    const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
    const token = `${enc({ alg: 'none', typ: 'JWT' })}.${enc({
      sub: user.id,
      email: user.email,
      sid: decodeJwt(user.accessToken)['sid'],
      iss: h.config.AUTH_ISSUER,
      aud: h.config.AUTH_AUDIENCE,
      exp: Math.floor(Date.now() / 1000) + 600,
    })}.`
    expect((await me(token)).statusCode).toBe(401)
  })

  it('rejects a validly signed token without a session claim', async () => {
    const user = await createUser(h)
    expect((await me(await forge(user, { sid: null }))).statusCode).toBe(401)
  })

  it('rejects a validly signed token for a session that does not exist', async () => {
    const user = await createUser(h)
    expect((await me(await forge(user, { sid: randomUUID() }))).statusCode).toBe(401)
  })
})

describe('password change', () => {
  it('rejects a wrong current password', async () => {
    const user = await createUser(h)
    const res = await h.app.inject({
      method: 'POST', url: '/api/v1/auth/change-password', headers: auth(user),
      payload: { currentPassword: 'not-the-password', newPassword: 'a-brand-new-passphrase' },
    })
    expect(res.statusCode).toBe(401)
    expect((await me(user.accessToken)).statusCode).toBe(200)
  })

  it('ends every session at once, clears the cookie and accepts only the new password', async () => {
    const user = await createUser(h)
    const other = await login(user.email)
    const changed = await h.app.inject({
      method: 'POST', url: '/api/v1/auth/change-password', headers: auth(user),
      payload: { currentPassword: PASSWORD, newPassword: 'a-brand-new-passphrase' },
    })
    expect(changed.statusCode).toBe(204)
    expect(changed.cookies.find((c) => c.name === REFRESH_COOKIE_NAME)?.value).toBe('')

    // Access tokens stop working immediately, not when they expire.
    expect((await me(user.accessToken)).statusCode).toBe(401)
    expect((await me(other.json().accessToken)).statusCode).toBe(401)
    // Refresh tokens issued before the change do not survive it.
    expect((await refresh(user.refreshToken)).statusCode).toBe(401)
    expect((await refresh(cookieToken(other))).statusCode).toBe(401)

    expect((await login(user.email, PASSWORD)).statusCode).toBe(401)
    expect((await login(user.email, 'a-brand-new-passphrase')).statusCode).toBe(200)
  })
})

describe('registration switch', () => {
  it('answers 403 registration_disabled when REGISTRATION_ENABLED=false, and still lets users sign in', async () => {
    const existing = await createUser(h)
    const app = buildApp({ db: h.db, config: { ...h.config, REGISTRATION_ENABLED: false } })
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { email: `closed-${randomUUID()}@example.com`, password: PASSWORD },
      })
      expect(res.statusCode).toBe(403)
      expect(res.json().code).toBe('registration_disabled')

      const signIn = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: existing.email, password: PASSWORD },
      })
      expect(signIn.statusCode).toBe(200)
    } finally {
      await app.close()
    }
  })
})

describe('rate limiting', () => {
  /** An app with tight limits on the shared database; closed after `run`. */
  async function withLimits(
    limits: Partial<Config>,
    run: (app: ReturnType<typeof buildApp>) => Promise<void>,
  ): Promise<void> {
    const app = buildApp({ db: h.db, config: { ...h.config, ...limits } })
    try {
      await run(app)
    } finally {
      await app.close()
    }
  }

  const badLogin = (app: ReturnType<typeof buildApp>, email: string) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password: 'wrong-password-entirely' },
    })

  it('limits each client address, with 429 rate_limited and Retry-After', async () => {
    await withLimits({ AUTH_RATE_LIMIT_MAX: 3, AUTH_EMAIL_RATE_LIMIT_MAX: 1000 }, async (app) => {
      for (let i = 0; i < 3; i += 1) {
        expect((await badLogin(app, `nobody-${i}@example.com`)).statusCode).toBe(401)
      }
      const limited = await badLogin(app, 'nobody-3@example.com')
      expect(limited.statusCode).toBe(429)
      expect(limited.json().code).toBe('rate_limited')
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0)
    })
  })

  it('limits each address on register and refresh too', async () => {
    await withLimits({ AUTH_RATE_LIMIT_MAX: 2, AUTH_EMAIL_RATE_LIMIT_MAX: 1000 }, async (app) => {
      const register = () =>
        app.inject({
          method: 'POST',
          url: '/api/v1/auth/register',
          payload: { email: `limit-${randomUUID()}@example.com`, password: PASSWORD },
        })
      expect((await register()).statusCode).toBe(201)
      expect((await register()).statusCode).toBe(201)
      expect((await register()).statusCode).toBe(429)

      expect((await refresh(undefined, CSRF, app)).statusCode).toBe(401)
      expect((await refresh(undefined, CSRF, app)).statusCode).toBe(401)
      expect((await refresh(undefined, CSRF, app)).statusCode).toBe(429)
    })
  })

  it('limits attempts per normalised email across spellings, without affecting other emails', async () => {
    await withLimits({ AUTH_RATE_LIMIT_MAX: 1000, AUTH_EMAIL_RATE_LIMIT_MAX: 2 }, async (app) => {
      const target = `victim-${randomUUID()}@example.com`
      expect((await badLogin(app, target)).statusCode).toBe(401)
      expect((await badLogin(app, target.toUpperCase())).statusCode).toBe(401)
      const limited = await badLogin(app, `  ${target}  `)
      expect(limited.statusCode).toBe(429)
      expect(limited.json().code).toBe('rate_limited')

      expect((await badLogin(app, `other-${randomUUID()}@example.com`)).statusCode).toBe(401)
    })
  })

  it('counts registration attempts per email separately from login attempts', async () => {
    await withLimits({ AUTH_RATE_LIMIT_MAX: 1000, AUTH_EMAIL_RATE_LIMIT_MAX: 1 }, async (app) => {
      const email = `both-${randomUUID()}@example.com`
      const register = () =>
        app.inject({
          method: 'POST',
          url: '/api/v1/auth/register',
          payload: { email, password: PASSWORD },
        })
      expect((await register()).statusCode).toBe(201)
      expect((await register()).statusCode).toBe(429)
      expect((await badLogin(app, email)).statusCode).toBe(401)
    })
  })
})

describe('session housekeeping', () => {
  it('purges sessions that expired or were revoked long ago and keeps recent ones', async () => {
    const user = await createUser(h) // one live session
    await asUser(h.db, user.id, async (trx) => {
      const insert = (expires: string, revoked: string | null) =>
        sql`
          INSERT INTO core.sessions (user_id, token_hash, expires_at, revoked_at)
          VALUES (${user.id}, ${randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '')},
                  now() + ${expires}::interval, ${revoked === null ? null : sql`now() + ${revoked}::interval`})
        `.execute(trx)
      await insert('-10 days', null) // expired long ago
      await insert('30 days', '-10 days') // revoked long ago
      await insert('-1 hour', null) // expired recently
      await insert('30 days', '-1 hour') // revoked recently
    })

    const service = new AuthService(new KyselyUnitOfWork(h.db), h.config)
    expect(await service.purgeDeadSessions()).toBeGreaterThanOrEqual(2)

    const remaining = await asUser(h.db, user.id, (trx) =>
      sql<{ n: string }>`SELECT count(*) AS n FROM core.sessions WHERE user_id = ${user.id}`.execute(trx),
    )
    expect(Number(remaining.rows[0]?.n)).toBe(3)
    expect((await me(user.accessToken)).statusCode).toBe(200)
  })
})

/**
 * The reset path, exercised through the service the CLI uses.
 */
describe('resetting a password from the server', () => {
  it('returns nothing for an unknown email', async () => {
    const service = new AuthService(new KyselyUnitOfWork(h.db), h.config)
    expect(await service.resetPassword('nobody-here@example.com', 'a-brand-new-password-entirely')).toBeUndefined()
  })

  it('replaces the digest and revokes every outstanding session', async () => {
    const user = await createUser(h)
    const service = new AuthService(new KyselyUnitOfWork(h.db), h.config)
    const reset = await service.resetPassword(`  ${user.email.toUpperCase()} `, 'a-brand-new-password-entirely')
    expect(reset).toBe(user.email)

    expect((await login(user.email, 'a-brand-new-password-entirely')).statusCode).toBe(200)
    expect((await login(user.email, PASSWORD)).statusCode).toBe(401)

    // The refresh token issued before the reset must be dead, or a reset would
    // be a weaker action than the password change it stands in for.
    expect((await refresh(user.refreshToken)).statusCode).toBe(401)
    expect((await me(user.accessToken)).statusCode).toBe(401)
  })
})
