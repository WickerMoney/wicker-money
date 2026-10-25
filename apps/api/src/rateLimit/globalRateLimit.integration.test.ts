import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { signPluginToken } from '../auth/pluginTokens.js'
import { exportHeaders, mintExportTicket, TEST_USER_PASSWORD } from '../testing/exportTicket.js'
import { auth, createHarness, createUser, type Harness, type TestUser } from '../testing/harness.js'

/**
 * The global per-user rate limit against the real app: who is counted, which
 * bucket, what a refusal looks like, what is left alone, and how it composes
 * with the sign-in limiter, the password-attempt limiter and the import gate.
 */

const PLUGIN = 'wickermoney.import-csv'
const ACCOUNTS = '/api/v1/accounts'
const ANALYZE = `/api/v1/p/${PLUGIN}/analyze`
const COMMIT = `/api/v1/p/${PLUGIN}/commit`
const EXPORT = '/api/v1/settings/export'

const get = (h: Harness, url: string, user?: TestUser, headers: Record<string, string> = {}) =>
  h.app.inject({ method: 'GET', url, headers: { ...(user === undefined ? {} : auth(user)), ...headers } })

const postImport = (h: Harness, url: string, user: TestUser, payload: Record<string, unknown> = {}) =>
  h.app.inject({ method: 'POST', url, headers: { ...auth(user), 'x-wickermoney-plugin': PLUGIN }, payload })

/** Sends `count` requests one after another and returns their statuses. */
async function statuses(count: number, send: () => Promise<{ statusCode: number }>): Promise<number[]> {
  const seen: number[] = []
  for (let i = 0; i < count; i += 1) seen.push((await send()).statusCode)
  return seen
}

describe('the general bucket', () => {
  let h: Harness
  beforeAll(async () => {
    h = await createHarness({ API_RATE_LIMIT_MAX: '5', API_RATE_LIMIT_WINDOW_SECONDS: '2' })
  })
  afterAll(async () => { await h.close() })

  it('refuses the request after the allowance with 429, Retry-After and the standard error shape, and lets the user back in when the window ends', async () => {
    const user = await createUser(h)
    expect(await statuses(5, () => get(h, ACCOUNTS, user))).toEqual([200, 200, 200, 200, 200])

    const refused = await get(h, ACCOUNTS, user)
    expect(refused.statusCode).toBe(429)
    expect(refused.json()).toEqual({
      code: 'rate_limited',
      message: expect.stringMatching(/^Too many requests\. Wait [12] seconds? and try again\.$/) as string,
    })
    const retryAfter = Number(refused.headers['retry-after'])
    expect(retryAfter).toBeGreaterThanOrEqual(1)
    expect(retryAfter).toBeLessThanOrEqual(2)

    await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000 + 100))
    expect((await get(h, ACCOUNTS, user)).statusCode).toBe(200)
  })

  it('does not share a bucket between two users', async () => {
    const [a, b] = await Promise.all([createUser(h), createUser(h)])
    expect(await statuses(6, () => get(h, ACCOUNTS, a))).toEqual([200, 200, 200, 200, 200, 429])
    expect(await statuses(5, () => get(h, ACCOUNTS, b))).toEqual([200, 200, 200, 200, 200])
  })

  it('counts a plugin token against the user it speaks for, together with the user\'s own requests', async () => {
    const user = await createUser(h)
    const sid = (JSON.parse(Buffer.from(user.accessToken.split('.')[1] as string, 'base64url').toString()) as { sid: string }).sid
    const { token } = await signPluginToken(h.config, { sub: user.id, email: user.email, sid, plg: PLUGIN, tbl: { accounts: 'read' } })
    const asPlugin = () => h.app.inject({ method: 'GET', url: '/api/v1/core/accounts/list', headers: { authorization: `Bearer ${token}` } })

    // Three from the plugin (refused or not by its own checks, each is counted) and two from the user.
    await statuses(3, asPlugin)
    expect(await statuses(2, () => get(h, ACCOUNTS, user))).toEqual([200, 200])
    expect((await get(h, ACCOUNTS, user)).statusCode).toBe(429)
    expect((await asPlugin()).statusCode).toBe(429)
  })

  it('counts requests without a valid token against the client address, and a forged token does not pick another user\'s bucket', async () => {
    // Registering counts too (it is an anonymous request from this address), so the allowance is one more than the 5 used here.
    const anon = await createHarness({ API_RATE_LIMIT_MAX: '6', API_RATE_LIMIT_WINDOW_SECONDS: '60' })
    try {
      const victim = await createUser(anon)
      expect(await statuses(5, () => get(anon, '/api/v1/nope'))).toEqual([404, 404, 404, 404, 404])
      expect((await get(anon, '/api/v1/nope')).statusCode).toBe(429)

      // The same address with a forged token naming the victim is the same anonymous bucket...
      const forged = await anon.app.inject({
        method: 'GET', url: ACCOUNTS,
        headers: { authorization: `Bearer ${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: victim.id })).toString('base64url')}.` },
      })
      expect(forged.statusCode).toBe(429)
      // ...and the victim's own allowance is untouched.
      expect((await get(anon, ACCOUNTS, victim)).statusCode).toBe(200)
    } finally {
      await anon.close()
    }
  })

  it('leaves the health checks, the web bundle and the frame document alone however often they are asked for', async () => {
    const web = await createHarness({ API_RATE_LIMIT_MAX: '2', WEB_DIST_DIR: new URL('../../../../apps/web/dist', import.meta.url).pathname })
    try {
      for (const url of ['/healthz', '/readyz', '/plugin-frame', '/']) {
        const codes = await statuses(8, () => get(web, url))
        expect(codes.filter((c) => c === 429), url).toEqual([])
      }
    } finally {
      await web.close()
    }
  })
})

describe('the import and export buckets', () => {
  let h: Harness
  beforeAll(async () => {
    h = await createHarness({
      API_RATE_LIMIT_MAX: '50', API_RATE_LIMIT_IMPORT_MAX: '3', API_RATE_LIMIT_EXPORT_MAX: '2', API_RATE_LIMIT_WINDOW_SECONDS: '60',
    })
    const { seedBundledPlugins } = await import('../plugins/registry.js')
    await seedBundledPlugins(h.db)
  })
  afterAll(async () => { await h.close() })

  it('limits analyze and commit together at the import allowance, and not the rest of the app', async () => {
    const user = await createUser(h)
    // The body is not a valid import, so each is a 400 from the handler: what is under test is that it was counted.
    expect(await statuses(2, () => postImport(h, ANALYZE, user))).toEqual([400, 400])
    expect((await postImport(h, COMMIT, user)).statusCode).toBe(400)
    const refused = await postImport(h, ANALYZE, user)
    expect(refused.statusCode).toBe(429)
    expect(refused.json()).toMatchObject({ code: 'rate_limited', message: expect.stringMatching(/^Too many imports\./) as string })
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0)
    expect((await postImport(h, COMMIT, user)).statusCode).toBe(429)

    // Everything else, including the rest of the import plugin's routes, still answers.
    expect(await statuses(10, () => get(h, ACCOUNTS, user))).toEqual(Array(10).fill(200))
    expect((await get(h, `/api/v1/p/${PLUGIN}/batches`, user, { 'x-wickermoney-plugin': PLUGIN })).statusCode).toBe(200)
  })

  it('gives each user an import bucket of their own', async () => {
    const [a, b] = await Promise.all([createUser(h), createUser(h)])
    await statuses(4, () => postImport(h, ANALYZE, a))
    expect((await postImport(h, ANALYZE, a)).statusCode).toBe(429)
    expect((await postImport(h, ANALYZE, b)).statusCode).toBe(400)
  })

  it('limits the export download at the export allowance, on its own bucket', async () => {
    const user = await createUser(h)
    const tickets = [await mintExportTicket(h.app, user), await mintExportTicket(h.app, user)]
    expect((await get(h, EXPORT, user, exportHeaders(user, tickets[0] as string))).statusCode).toBe(200)
    expect((await get(h, EXPORT, user, exportHeaders(user, tickets[1] as string))).statusCode).toBe(200)
    const refused = await get(h, EXPORT, user, exportHeaders(user, await mintExportTicket(h.app, user)))
    expect(refused.statusCode).toBe(429)
    expect(refused.json()).toMatchObject({ code: 'rate_limited', message: expect.stringMatching(/^Too many exports\./) as string })
    // The other buckets are untouched.
    expect((await get(h, ACCOUNTS, user)).statusCode).toBe(200)
    expect((await postImport(h, ANALYZE, user)).statusCode).toBe(400)
  })
})

describe('the limits that were already there', () => {
  let h: Harness
  beforeAll(async () => {
    h = await createHarness({ API_RATE_LIMIT_MAX: '1000', AUTH_EMAIL_RATE_LIMIT_MAX: '3', AUTH_RATE_LIMIT_MAX: '4' })
  })
  afterAll(async () => { await h.close() })

  it('still stops password attempts at the export ticket and the erase route after AUTH_EMAIL_RATE_LIMIT_MAX, with the generic message', async () => {
    const user = await createUser(h)
    const ticket = () => h.app.inject({ method: 'POST', url: '/api/v1/settings/export-ticket', headers: auth(user), payload: { password: 'wrong' } })
    expect(await statuses(3, ticket)).toEqual([403, 403, 403])
    const refused = await ticket()
    expect(refused.statusCode).toBe(429)
    expect(refused.json()).toEqual({ code: 'rate_limited', message: 'Too many requests. Try again later.' })
    const erase = await h.app.inject({
      method: 'POST', url: '/api/v1/settings/erase-my-data', headers: auth(user), payload: { password: 'wrong', confirmation: 'ERASE' },
    })
    expect(erase.statusCode).toBe(429)
  })

  it('still stops sign-in attempts after AUTH_RATE_LIMIT_MAX per address, with the generic message', async () => {
    const attempt = (n: number) => h.app.inject({
      method: 'POST', url: '/api/v1/auth/login', payload: { email: `nobody-${n}@example.com`, password: TEST_USER_PASSWORD },
    })
    const codes: number[] = []
    for (let i = 0; i < 5; i += 1) codes.push((await attempt(i)).statusCode)
    expect(codes).toEqual([401, 401, 401, 401, 429])
    expect((await attempt(9)).json()).toEqual({ code: 'rate_limited', message: 'Too many requests. Try again later.' })
  })
})

describe('turned off', () => {
  it('counts nothing when API_RATE_LIMIT_ENABLED is false', async () => {
    const h = await createHarness({ API_RATE_LIMIT_ENABLED: 'false', API_RATE_LIMIT_MAX: '1', API_RATE_LIMIT_IMPORT_MAX: '1' })
    try {
      const user = await createUser(h)
      expect(await statuses(10, () => get(h, ACCOUNTS, user))).toEqual(Array(10).fill(200))
      expect(await statuses(5, () => postImport(h, ANALYZE, user))).toEqual(Array(5).fill(400))
    } finally {
      await h.close()
    }
  })
})

describe('with the import gate (IMPORT_MAX_CONCURRENT)', () => {
  let h: Harness
  beforeAll(async () => {
    h = await createHarness({
      IMPORT_MAX_CONCURRENT: '1', IMPORT_QUEUE_WAIT_SECONDS: '0', API_RATE_LIMIT_IMPORT_MAX: '3', API_RATE_LIMIT_MAX: '1000',
    })
    const { seedBundledPlugins } = await import('../plugins/registry.js')
    await seedBundledPlugins(h.db)
  })
  afterAll(async () => { await h.close() })

  const mapping = {
    sourceName: 'Test Bank', columns: { date: 'Date', merchant: 'Description', amount: 'Amount', externalId: 'Id' },
    dateFormat: 'MM/DD/YYYY', amountStyle: 'signed', invertAmount: false,
  }

  async function importer(): Promise<{ user: TestUser; accountId: string }> {
    const user = await createUser(h)
    const res = await h.app.inject({
      method: 'POST', url: ACCOUNTS, headers: auth(user), payload: { name: 'Everyday', accountType: 'checking', openingBalance: '0.00' },
    })
    return { user, accountId: (res.json() as { id: string }).id }
  }

  const csv = (rows: number, tag: string): string =>
    ['Date,Description,Amount,Id', ...Array.from({ length: rows }, (_, i) =>
      `03/${String((i % 28) + 1).padStart(2, '0')}/2026,MERCHANT ${i % 331} ${tag},-${Math.floor(i / 100) + 1}.${String(i % 100).padStart(2, '0')},${tag}-${i}`)].join('\n')

  const commit = (who: { user: TestUser; accountId: string }, file: string, key: string) =>
    postImport(h, COMMIT, who.user, { accountId: who.accountId, csv: file, fileName: 'f.csv', acceptRowNumbers: [], idempotencyKey: key, ...mapping })

  it('counts requests; the gate caps commits in flight. A request over the allowance is refused 429 first, even while the gate is full, and takes no slot', async () => {
    const [busy, spender] = await Promise.all([importer(), importer()])
    // The spender uses its whole import allowance on small commits (each takes and frees the one slot).
    for (let i = 0; i < 3; i += 1) expect((await commit(spender, csv(3, `s${i}`), `k${i}`)).statusCode).toBe(200)

    // Another user's large commit now holds the only slot...
    const big = commit(busy, csv(20_000, 'big'), 'big')
    await new Promise((resolve) => setTimeout(resolve, 400))
    // ...a person inside their allowance is told the gate is busy (503, import_busy)...
    const other = await importer()
    const gated = await commit(other, csv(3, 'o'), 'o1')
    expect(gated.statusCode).toBe(503)
    expect(gated.json()).toMatchObject({ code: 'import_busy' })
    // ...and the one over their allowance is told that instead (429, rate_limited), whatever the gate is doing.
    const limited = await commit(spender, csv(3, 'again'), 'k-again')
    expect(limited.statusCode).toBe(429)
    expect(limited.json()).toMatchObject({ code: 'rate_limited' })
    expect(await big).toMatchObject({ statusCode: 200 })

    // Nothing leaked: with the big commit done the slot is free for someone inside their allowance.
    expect((await commit(other, csv(3, 'o'), 'o2')).statusCode).toBe(200)
  }, 60_000)
})
