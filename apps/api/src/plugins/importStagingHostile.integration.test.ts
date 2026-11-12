import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadConfig } from '../config.js'
import { auth, createHarness, createUser, TEST_AUTH_SECRET, TEST_DATABASE_URL, type Harness, type TestUser } from '../testing/harness.js'

/**
 * Staged CSV upload, the cases `importStaging.integration.test.ts` does not
 * reach: the rate buckets with real uploads, the planned uploader's pacing
 * against the shipped limits, what a chunk costs on the broker's wire, ids that
 * must look alike to a caller who may not use them, and the process-wide cap
 * once an upload is aborted.
 *
 * Each describe block builds its own app, so no block's uploads, rate counts or
 * reserved bytes reach another's.
 */

const PLUGIN = 'wickermoney.import-csv'
const BASE = `/api/v1/p/${PLUGIN}`
/** The plugin broker's cap on a serialised request body (`DEFAULT_BROKER_LIMITS.maxBodyBytes`, apps/web). */
const BROKER_BODY_BYTES = 256 * 1024
/** The chunk route's cap on one chunk's UTF-8 text (`MAX_CHUNK_BYTES`). */
const CHUNK_BYTES = 256 * 1024

const MAPPING = {
  sourceName: 'Test Bank',
  columns: { date: 'Date', merchant: 'Description', amount: 'Amount', externalId: 'Id' },
  dateFormat: 'MM/DD/YYYY',
  amountStyle: 'signed',
  invertAmount: false,
}

const NOT_FOUND_UUID = '0b9a2f4e-7c1d-4e0a-9d63-5a1f2c3b4d5e'

function sender(h: Harness) {
  const headers = (u: TestUser) => ({ ...auth(u), 'x-wickermoney-plugin': PLUGIN })
  const post = (path: string, payload: Record<string, unknown>, u: TestUser) =>
    h.app.inject({ method: 'POST', url: `${BASE}${path}`, headers: headers(u), payload })
  return {
    post,
    begin: (u: TestUser, chunks: number, bytes: number) => post('/upload/begin', { chunks, bytes }, u),
    chunk: (u: TestUser, uploadId: string, index: number, text: string) => post('/upload/chunk', { uploadId, index, text }, u),
    finish: (u: TestUser, uploadId: string) => post('/upload/finish', { uploadId }, u),
    abort: (u: TestUser, uploadId: string) => post('/upload/abort', { uploadId }, u),
    account: async (u: TestUser, name: string): Promise<string> => {
      const res = await h.app.inject({
        method: 'POST', url: '/api/v1/accounts', headers: auth(u),
        payload: { name, accountType: 'checking', openingBalance: '0.00' },
      })
      if (res.statusCode !== 201) throw new Error(`account failed: ${res.statusCode} ${res.body}`)
      return (res.json() as { id: string }).id
    },
  }
}

/** A file of `rows` distinct rows. */
function file(rows: number, tag: string): string {
  const lines = ['Date,Description,Amount,Id']
  for (let i = 0; i < rows; i += 1) {
    const day = String((i % 28) + 1).padStart(2, '0')
    lines.push(`03/${day}/2026,"MERCHANT, ${i % 331} ${tag}",-${Math.floor(i / 100) + 1}.${String(i % 100).padStart(2, '0')},${tag}-${i}`)
  }
  return lines.join('\n')
}

/** Runs `tasks` with at most `limit` in flight, and reports the most that were. */
async function pool<T>(tasks: ReadonlyArray<() => Promise<T>>, limit: number): Promise<{ results: T[]; peak: number }> {
  const results: T[] = new Array<T>(tasks.length)
  let next = 0
  let inFlight = 0
  let peak = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next
      next += 1
      if (i >= tasks.length) return
      inFlight += 1
      peak = Math.max(peak, inFlight)
      try { results[i] = await (tasks[i] as () => Promise<T>)() } finally { inFlight -= 1 }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => worker()))
  return { results, peak }
}

describe('rate buckets with real uploads', () => {
  let h: Harness
  let s: ReturnType<typeof sender>
  beforeAll(async () => {
    h = await createHarness({ API_RATE_LIMIT_MAX: '200', API_RATE_LIMIT_IMPORT_MAX: '6', API_RATE_LIMIT_WINDOW_SECONDS: '60' })
    const { seedBundledPlugins } = await import('./registry.js')
    await seedBundledPlugins(h.db)
    s = sender(h)
  })
  afterAll(async () => { await h.close() })

  it('refuses a burst of begin calls after the import allowance, 409s counted, while chunks and finish still go through', async () => {
    const u = await createUser(h)
    const seen: number[] = []
    let live = ''
    for (let i = 0; i < 9; i += 1) {
      const res = await s.begin(u, 2, 6)
      seen.push(res.statusCode)
      if (i === 0) live = (res.json() as { uploadId: string }).uploadId
    }
    // Two live uploads, then the per-user limit (409) which still costs a count, then the bucket (429).
    expect(seen).toEqual([200, 200, 409, 409, 409, 409, 429, 429, 429])
    const refused = await s.begin(u, 2, 6)
    expect(refused.statusCode).toBe(429)
    expect(refused.json()).toMatchObject({ code: 'rate_limited', message: expect.stringMatching(/^Too many imports\./) as string })
    expect(Number(refused.headers['retry-after'])).toBeGreaterThanOrEqual(1)

    // The upload that was opened is not hurt: its chunks and finish are in the general bucket, 60 more calls answer.
    for (let i = 0; i < 30; i += 1) expect((await s.chunk(u, live, 0, 'aaa')).statusCode, `repeat ${i}`).toBe(200)
    expect((await s.chunk(u, live, 1, 'bbb')).json()).toEqual({ chunks: 2, received: 2, bytes: 6 })
    expect((await s.finish(u, live)).statusCode).toBe(200)
    // analyze is in the exhausted bucket; abort and the rest of the app are not.
    const accountId = await s.account(u, 'Everyday')
    expect((await s.post('/analyze', { accountId, uploadId: live, ...MAPPING }, u)).statusCode).toBe(429)
    expect((await s.abort(u, live)).statusCode).toBe(200)
  })

  it('keeps the two buckets apart in the other direction: exhausting the general one leaves begin open', async () => {
    const small = await createHarness({ API_RATE_LIMIT_MAX: '12', API_RATE_LIMIT_IMPORT_MAX: '30', API_RATE_LIMIT_WINDOW_SECONDS: '60' })
    try {
      const { seedBundledPlugins } = await import('./registry.js')
      await seedBundledPlugins(small.db)
      const t = sender(small)
      const u = await createUser(small)
      const opened = await t.begin(u, 1, 3)
      expect(opened.statusCode).toBe(200)
      const { uploadId } = opened.json() as { uploadId: string }
      const codes: number[] = []
      for (let i = 0; i < 16; i += 1) codes.push((await t.chunk(u, uploadId, 0, 'abc')).statusCode)
      expect(codes.slice(0, 12)).toEqual(Array(12).fill(200))
      expect(codes.slice(12)).toEqual([429, 429, 429, 429])
      // A fresh begin is not a general-bucket request, so it still answers (409: the user holds one, and has room for one more).
      expect((await t.begin(u, 1, 3)).statusCode).toBe(200)
      expect((await t.begin(u, 1, 3)).statusCode).toBe(409)
    } finally {
      await small.close()
    }
  })
})

describe('the planned uploader against the shipped limits', () => {
  let h: Harness
  let s: ReturnType<typeof sender>
  beforeAll(async () => {
    // The shipped allowances, written out so a change to a default shows up here.
    h = await createHarness({ API_RATE_LIMIT_MAX: '600', API_RATE_LIMIT_IMPORT_MAX: '30', API_RATE_LIMIT_WINDOW_SECONDS: '60' })
    const { seedBundledPlugins } = await import('./registry.js')
    await seedBundledPlugins(h.db)
    s = sender(h)
  })
  afterAll(async () => { await h.close() })

  it('uses the defaults it assumes: 600 requests, 30 imports, a 60 second window', () => {
    const shipped = loadConfig({ NODE_ENV: 'test', DATABASE_URL: TEST_DATABASE_URL, AUTH_SECRET: TEST_AUTH_SECRET } as NodeJS.ProcessEnv)
    expect([shipped.API_RATE_LIMIT_MAX, shipped.API_RATE_LIMIT_IMPORT_MAX, shipped.API_RATE_LIMIT_WINDOW_SECONDS]).toEqual([600, 30, 60])
  })

  it('stages a 100,000-row file as 36 chunks of about 200,000 characters, 6 in flight, and leaves the buckets nearly untouched', async () => {
    const u = await createUser(h)
    const accountId = await s.account(u, 'Everyday')
    // About 71 characters a row, which is what 36 chunks of 200,000 characters hold.
    const lines = ['Date,Description,Amount,Id']
    for (let i = 0; i < 100_000; i += 1) {
      const day = String((i % 28) + 1).padStart(2, '0')
      lines.push(`03/${day}/2026,"CARD PURCHASE, STORE ${String(i % 997).padStart(3, '0')} CITY ${i % 331} REF POS",-${Math.floor(i / 100) + 1}.${String(i % 100).padStart(2, '0')},p-${i}`)
    }
    const csv = lines.join('\n')
    const bytes = Buffer.byteLength(csv)
    expect(bytes).toBeLessThanOrEqual(8_000_000)
    const SIZE = 200_000
    const parts: string[] = []
    for (let i = 0; i < csv.length; i += SIZE) parts.push(csv.slice(i, i + SIZE))
    expect(parts).toHaveLength(36)

    const t0 = performance.now()
    const opened = await s.begin(u, parts.length, bytes)
    expect(opened.statusCode, opened.body).toBe(200)
    const { uploadId } = opened.json() as { uploadId: string }
    const wire = parts.map((text, index) => Buffer.byteLength(JSON.stringify({ uploadId, index, text })))
    const { results, peak } = await pool(parts.map((text, i) => () => s.chunk(u, uploadId, i, text)), 6)
    const uploaded = performance.now() - t0
    expect(results.map((r) => r.statusCode)).toEqual(Array(36).fill(200))
    expect(peak).toBe(6)
    const done = await s.finish(u, uploadId)
    expect(done.json()).toEqual({ chunks: 36, received: 36, bytes })

    // Each chunk fits the broker's 256 KiB body cap as the broker measures it (the serialised body), with room.
    const widest = Math.max(...wire)
    expect(widest).toBeLessThanOrEqual(BROKER_BODY_BYTES)

    const analyzed = await s.post('/analyze', { accountId, uploadId, ...MAPPING }, u)
    expect(analyzed.statusCode, analyzed.body.slice(0, 200)).toBe(200)
    expect(analyzed.json()).toMatchObject({ summary: { new: 100_000 } })

    // The general bucket holds 600: the account, 36 chunks and finish are 38 of them. Count what is left by spending it.
    let left = 0
    for (;;) {
      const res = await s.abort(u, NOT_FOUND_UUID)
      if (res.statusCode === 429) break
      expect(res.statusCode).toBe(200)
      left += 1
      if (left > 700) throw new Error('the general bucket never closed')
    }
    expect(left).toBe(600 - 38)
    // The import bucket holds 30: begin and analyze are 2 of them, so 28 more are accepted (400: the body is not an import).
    let importLeft = 0
    for (;;) {
      const res = await s.post('/analyze', {}, u)
      if (res.statusCode === 429) break
      expect(res.statusCode).toBe(400)
      importLeft += 1
      if (importLeft > 40) throw new Error('the import bucket never closed')
    }
    expect(importLeft).toBe(30 - 2)

    console.log(
      `PACING 100,000 rows: ${bytes} bytes, ${parts.length} chunks, widest chunk ${widest} of ${BROKER_BODY_BYTES} wire bytes ` +
      `(${(widest / BROKER_BODY_BYTES * 100).toFixed(1)}%), peak in flight ${peak}, upload ${(uploaded / 1000).toFixed(2)} s; ` +
      `general bucket after upload+finish+account: ${left} of 600 left; import bucket after begin+analyze: ${importLeft} of 30 left`,
    )
  }, 180_000)

  it('shows how many complete imports the buckets allow in a window: 10 by the import bucket, 16 by the general one', () => {
    const generalPerUpload = 36 + 1 // chunks and finish
    const importPerUpload = 3 // begin, analyze, commit
    expect(Math.floor(600 / generalPerUpload)).toBe(16)
    expect(Math.floor(30 / importPerUpload)).toBe(10)
  })
})

describe('what a chunk costs on the wire', () => {
  let h: Harness
  let s: ReturnType<typeof sender>
  beforeAll(async () => {
    h = await createHarness()
    s = sender(h)
  })
  afterAll(async () => { await h.close() })

  /** The largest count of `unit` whose chunk both serialises within the broker's cap and holds at most the route's bytes. */
  function fits(unit: string, wrap: (text: string) => string = (t) => t): { chars: number; json: number; utf8: number } {
    const json = (n: number) => Buffer.byteLength(JSON.stringify({ uploadId: NOT_FOUND_UUID, index: 63, text: wrap(unit.repeat(n)) }))
    let lo = 0
    let hi = 1_000_000
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2)
      if (json(mid) <= BROKER_BODY_BYTES && Buffer.byteLength(unit.repeat(mid)) <= CHUNK_BYTES) lo = mid
      else hi = mid - 1
    }
    return { chars: lo * unit.length, json: json(lo), utf8: Buffer.byteLength(unit.repeat(lo)) }
  }

  it('fits 200,000 characters only for ordinary text: the safe size is a number of bytes, not of characters', () => {
    const table = {
      ascii: fits('a'), 'csv row, 2 quotes in 71': fits('03/05/2026,"CARD PURCHASE, STORE 123 CITY 45 REF",-12.34,p-1234567\n'),
      quotes: fits('"'), newlines: fits('\n'), 'e acute (2 bytes)': fits('é'), 'cjk (3 bytes)': fits('語'),
      'emoji (4 bytes, 2 code units)': fits('😀'), 'control (6 bytes of json)': fits('\u0001'),
    }
    console.log(`CHUNK-SAFE characters per class: ${JSON.stringify(Object.fromEntries(Object.entries(table).map(([k, v]) => [k, v.chars])))}`)
    expect(table.ascii.chars).toBeGreaterThan(200_000)
    expect(table['csv row, 2 quotes in 71'].chars).toBeGreaterThan(200_000)
    // Every class below holds fewer than 200,000 characters in a chunk, so a character-count uploader would be refused.
    for (const key of ['quotes', 'newlines', 'e acute (2 bytes)', 'cjk (3 bytes)', 'emoji (4 bytes, 2 code units)', 'control (6 bytes of json)'] as const) {
      expect(table[key].chars, key).toBeLessThan(200_000)
    }
    // Which limit bites: the route's UTF-8 bytes for multi-byte text, the broker's serialised body for text JSON escapes.
    expect(table['cjk (3 bytes)'].utf8).toBeLessThanOrEqual(CHUNK_BYTES)
    expect(table.quotes.json).toBeLessThanOrEqual(BROKER_BODY_BYTES)
  })

  it('refuses 200,000 characters of 2-byte and 3-byte text as chunk_too_large, and takes the same text cut to 256 KiB', async () => {
    const u = await createUser(h)
    const { uploadId } = (await s.begin(u, 3, 3 * CHUNK_BYTES)).json() as { uploadId: string }
    for (const [unit, label] of [['é', 'é'], ['語', '語']] as const) {
      const over = await s.chunk(u, uploadId, 0, unit.repeat(200_000))
      expect(over.statusCode, label).toBe(413)
      expect(over.json(), label).toMatchObject({ code: 'chunk_too_large' })
    }
    const exact = await s.chunk(u, uploadId, 1, 'é'.repeat(CHUNK_BYTES / 2))
    expect(exact.statusCode, exact.body).toBe(200)
    expect(exact.json()).toMatchObject({ received: 1, bytes: CHUNK_BYTES })
    const one = await s.chunk(u, uploadId, 2, 'é'.repeat(CHUNK_BYTES / 2 + 1))
    expect(one.statusCode).toBe(413)
  })

  it('answers a body over the route limit with 413 and no stored text, whatever it holds', async () => {
    const u = await createUser(h)
    const { uploadId } = (await s.begin(u, 2, 10)).json() as { uploadId: string }
    // 1 MiB of text, and 200,000 control characters that JSON writes as 1.2 MB.
    for (const text of ['a'.repeat(1024 * 1024 + 1), '\u0001'.repeat(200_000)]) {
      const res = await s.chunk(u, uploadId, 0, text)
      expect(res.statusCode).toBe(413)
      expect(res.body).not.toContain('aaaa')
    }
    expect((await s.chunk(u, uploadId, 0, 'abc')).json()).toMatchObject({ received: 1, bytes: 3 })
  })

  it('treats a size given in characters as a size in bytes: text with accents is refused as it arrives, not at the end', async () => {
    const u = await createUser(h)
    const text = 'Café,Crème,Façade,naïve,Zoë\n'.repeat(4)
    expect(Buffer.byteLength(text)).toBeGreaterThan(text.length)
    const wrong = (await s.begin(u, 1, text.length)).json() as { uploadId: string }
    const over = await s.chunk(u, wrong.uploadId, 0, text)
    expect(over.statusCode).toBe(413)
    expect(over.json()).toMatchObject({ code: 'upload_too_large' })
    expect((await s.finish(u, wrong.uploadId)).statusCode).toBe(404)
    const right = (await s.begin(u, 1, Buffer.byteLength(text))).json() as { uploadId: string }
    expect((await s.chunk(u, right.uploadId, 0, text)).statusCode).toBe(200)
    expect((await s.finish(u, right.uploadId)).statusCode).toBe(200)
  })
})

describe('ids a caller may not use', () => {
  let h: Harness
  let s: ReturnType<typeof sender>
  beforeAll(async () => {
    h = await createHarness()
    const { seedBundledPlugins } = await import('./registry.js')
    await seedBundledPlugins(h.db)
    s = sender(h)
  })
  afterAll(async () => { await h.close() })

  /** Everything an attacker sees of a reply except what differs on every request. */
  function seen(res: { statusCode: number; body: string; headers: Record<string, unknown> }) {
    const headers = { ...res.headers }
    for (const volatile of ['date', 'x-request-id', 'etag']) delete headers[volatile]
    return { status: res.statusCode, body: res.body, headers }
  }

  it('answers another user\'s upload, in every state, byte for byte like an id nobody holds', async () => {
    const owner = await createUser(h)
    const stranger = await createUser(h)
    const ownerAccount = await s.account(owner, 'Owner')
    const strangerAccount = await s.account(stranger, 'Stranger')
    const csv = file(6, 'ids')
    const bytes = Buffer.byteLength(csv)

    const receiving = (await s.begin(owner, 2, bytes)).json() as { uploadId: string }
    await s.chunk(owner, receiving.uploadId, 0, csv.slice(0, 40))

    const ready = (await s.begin(owner, 1, bytes)).json() as { uploadId: string }
    await s.chunk(owner, ready.uploadId, 0, csv)
    await s.finish(owner, ready.uploadId)

    // A third live upload is not allowed, so free a slot and make the committed one; keep `ready` and `receiving` live.
    await s.abort(owner, receiving.uploadId)
    const committed = (await s.begin(owner, 1, bytes)).json() as { uploadId: string }
    await s.chunk(owner, committed.uploadId, 0, csv)
    await s.finish(owner, committed.uploadId)
    const done = await s.post('/commit', { accountId: ownerAccount, uploadId: committed.uploadId, idempotencyKey: 'k-ids', ...MAPPING }, owner)
    expect(done.statusCode, done.body).toBe(200)
    const aborted = (await s.begin(owner, 1, bytes)).json() as { uploadId: string }
    await s.abort(owner, aborted.uploadId)
    // `receiving` was aborted above, so reopen one to have all of: receiving, ready, committed (receipt), aborted.
    const receiving2 = (await s.begin(owner, 2, bytes)).json() as { uploadId: string }
    await s.chunk(owner, receiving2.uploadId, 0, csv.slice(0, 40))

    const asked = (id: string) => [
      () => s.chunk(stranger, id, 0, 'x'),
      () => s.chunk(stranger, id, 1, csv.slice(40)),
      () => s.finish(stranger, id),
      () => s.post('/analyze', { accountId: strangerAccount, uploadId: id, ...MAPPING }, stranger),
      () => s.post('/commit', { accountId: strangerAccount, uploadId: id, idempotencyKey: 'k-ids', ...MAPPING }, stranger),
    ]
    const baseline = await Promise.all(asked(NOT_FOUND_UUID).map((f) => f()))
    expect(baseline.map((r) => r.statusCode)).toEqual([404, 404, 404, 404, 404])
    for (const [state, id] of [['receiving', receiving2.uploadId], ['ready', ready.uploadId], ['committed', committed.uploadId], ['aborted', aborted.uploadId]] as const) {
      const replies = await Promise.all(asked(id).map((f) => f()))
      for (const [i, res] of replies.entries()) expect(seen(res), `${state} #${i}`).toEqual(seen(baseline[i] as (typeof baseline)[number]))
    }
    // abort is a 200 with an empty object for every one of them, so it says nothing either.
    const strange = await Promise.all([receiving2.uploadId, ready.uploadId, committed.uploadId, NOT_FOUND_UUID].map((id) => s.abort(stranger, id)))
    expect(new Set(strange.map((r) => JSON.stringify(seen(r)))).size).toBe(1)

    // None of it touched the owner's uploads or the owner's receipt.
    expect((await s.chunk(owner, receiving2.uploadId, 1, csv.slice(40))).statusCode).toBe(200)
    expect((await s.finish(owner, receiving2.uploadId)).statusCode).toBe(200)
    const analyzed = await s.post('/analyze', { accountId: ownerAccount, uploadId: ready.uploadId, ...MAPPING }, owner)
    expect(analyzed.statusCode).toBe(200)
    const replay = await s.post('/commit', { accountId: ownerAccount, uploadId: committed.uploadId, idempotencyKey: 'k-ids', ...MAPPING }, owner)
    expect(replay.json()).toMatchObject({ replayed: true })
  })

  it('does not echo staged text in any refusal a stranger gets', async () => {
    const owner = await createUser(h)
    const stranger = await createUser(h)
    const strangerAccount = await s.account(stranger, 'Stranger')
    const marker = 'SECRET-STAGED-MARKER-7f3a'
    const csv = `Date,Description,Amount,Id\n03/05/2026,"${marker}",-1.00,m-1`
    const { uploadId } = (await s.begin(owner, 1, Buffer.byteLength(csv))).json() as { uploadId: string }
    await s.chunk(owner, uploadId, 0, csv)
    await s.finish(owner, uploadId)
    const replies = [
      await s.chunk(stranger, uploadId, 0, 'x'), await s.finish(stranger, uploadId), await s.abort(stranger, uploadId),
      await s.post('/analyze', { accountId: strangerAccount, uploadId, ...MAPPING }, stranger),
      await s.post('/commit', { accountId: strangerAccount, uploadId, ...MAPPING }, stranger),
      await s.post('/analyze', { accountId: strangerAccount, uploadId, csv, ...MAPPING }, stranger),
    ]
    for (const res of replies) expect(res.body).not.toContain(marker)
    // The last one is both fields, refused as a bad request before any lookup; the owner's text is still the owner's.
    expect(replies[5]?.statusCode).toBe(400)
    const ownerAccount = await s.account(owner, 'Owner')
    const mine = await s.post('/analyze', { accountId: ownerAccount, uploadId, ...MAPPING }, owner)
    expect(JSON.stringify(mine.json())).toContain(marker)
  })
})

describe('the staging space once an upload is aborted', () => {
  let h: Harness
  let s: ReturnType<typeof sender>
  beforeAll(async () => {
    h = await createHarness()
    s = sender(h)
  })
  afterAll(async () => { await h.close() })

  it('frees its reserved bytes at once for the next begin, and a stranger\'s abort frees nothing', async () => {
    const users: TestUser[] = []
    for (let i = 0; i < 6; i += 1) users.push(await createUser(h))
    const held: Array<{ user: TestUser; uploadId: string }> = []
    for (const u of users.slice(0, 4)) {
      for (let i = 0; i < 2; i += 1) {
        const res = await s.begin(u, 64, 8_000_000)
        expect(res.statusCode, res.body).toBe(200)
        held.push({ user: u, uploadId: (res.json() as { uploadId: string }).uploadId })
      }
    }
    const fifth = users[4] as TestUser
    const sixth = users[5] as TestUser
    const full = await s.begin(fifth, 1, 1)
    expect(full.statusCode).toBe(503)
    expect(full.json()).toMatchObject({ code: 'staging_full' })
    expect(Number.isInteger(Number(full.headers['retry-after']))).toBe(true)
    expect(Number(full.headers['retry-after'])).toBeGreaterThan(0)
    // A refusal holds nothing: there is no id to send data to, and the user's own quota is untouched.
    expect(full.json()).not.toHaveProperty('uploadId')

    const first = held[0] as (typeof held)[number]
    // Someone else's abort of a held id answers like any other abort and frees nothing.
    expect((await s.abort(fifth, first.uploadId)).statusCode).toBe(200)
    expect((await s.begin(fifth, 1, 1)).statusCode).toBe(503)
    // The owner's frees 8,000,000 bytes: exactly one largest upload fits, and then it is full again.
    expect((await s.abort(first.user, first.uploadId)).statusCode).toBe(200)
    const taken = await s.begin(sixth, 64, 8_000_000)
    expect(taken.statusCode, taken.body).toBe(200)
    expect((await s.begin(fifth, 1, 1)).statusCode).toBe(503)
    // The refused begins above did not use up the fifth user's two slots.
    await s.abort(sixth, (taken.json() as { uploadId: string }).uploadId)
    expect((await s.begin(fifth, 1, 1)).statusCode).toBe(200)
    expect((await s.begin(fifth, 1, 1)).statusCode).toBe(200)
    expect((await s.begin(fifth, 1, 1)).statusCode).toBe(409)
  }, 60_000)
})
