import { sql } from 'kysely'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { signAccessToken } from '../auth/tokens.js'
import { asUser } from '../db/client.js'
import { auth, createHarness, createUser, type Harness, type TestUser } from '../testing/harness.js'

/**
 * Staged CSV upload (`/upload/begin`, `/upload/chunk`, `/upload/finish`) against
 * the real app and database: the limits as data arrives, another user's id,
 * expiry on a faked clock, and `analyze` / `commit` by `uploadId` against the
 * same calls with a `csv` body.
 */

const PLUGIN = 'wickermoney.import-csv'
const BASE = `/api/v1/p/${PLUGIN}`
const MAX_CHUNK_BYTES = 256 * 1024
const MINUTE = 60_000

const MAPPING = {
  sourceName: 'Test Bank',
  columns: { date: 'Date', merchant: 'Description', amount: 'Amount', externalId: 'Id' },
  dateFormat: 'MM/DD/YYYY',
  amountStyle: 'signed',
  invertAmount: false,
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

let h: Harness
let user: TestUser
let other: TestUser

const headers = (u: TestUser) => ({ ...auth(u), 'x-wickermoney-plugin': PLUGIN })
const post = (path: string, payload: Record<string, unknown>, u: TestUser) =>
  h.app.inject({ method: 'POST', url: `${BASE}${path}`, headers: headers(u), payload })

async function newAccount(u: TestUser, name: string): Promise<string> {
  const res = await h.app.inject({
    method: 'POST', url: '/api/v1/accounts', headers: auth(u),
    payload: { name, accountType: 'checking', openingBalance: '0.00' },
  })
  if (res.statusCode !== 201) throw new Error(`account failed: ${res.statusCode} ${res.body}`)
  return (res.json() as { id: string }).id
}

const begin = (u: TestUser, chunks: number, bytes: number) => post('/upload/begin', { chunks, bytes }, u)
const chunk = (u: TestUser, uploadId: string, index: number, text: string) => post('/upload/chunk', { uploadId, index, text }, u)
const finish = (u: TestUser, uploadId: string) => post('/upload/finish', { uploadId }, u)

/** Splits `text` into pieces of `size` characters. */
function pieces(text: string, size: number): string[] {
  const out: string[] = []
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size))
  return out
}

/** Stages `csv` for `u`: begin, every chunk in reverse order with the first sent twice, finish. */
async function stage(u: TestUser, csv: string, size = 20_000): Promise<string> {
  const parts = pieces(csv, size)
  const opened = await begin(u, parts.length, Buffer.byteLength(csv))
  expect(opened.statusCode, opened.body).toBe(200)
  const { uploadId } = opened.json() as { uploadId: string }
  for (let i = parts.length - 1; i >= 0; i -= 1) expect((await chunk(u, uploadId, i, parts[i] as string)).statusCode).toBe(200)
  expect((await chunk(u, uploadId, 0, parts[0] as string)).statusCode).toBe(200)
  const done = await finish(u, uploadId)
  expect(done.statusCode, done.body).toBe(200)
  return uploadId
}

/** The error a caller sees for an id it may not use. */
const NOT_FOUND = { code: 'upload_not_found', message: expect.stringMatching(/not available/) as string }

/** A token for the same user and session, signed at the faked present, since the real one expires in 15 minutes. */
async function freshToken(u: TestUser): Promise<TestUser> {
  const claims = JSON.parse(Buffer.from(u.accessToken.split('.')[1] as string, 'base64url').toString()) as { sub: string; email: string; sid: string }
  return { ...u, accessToken: await signAccessToken(h.config, claims) }
}

async function ledger(u: TestUser, accountId: string) {
  return asUser(h.db, u.id, async (trx) => {
    const r = await sql<{ merchant: string; amount: string; transaction_date: string; external_id: string | null }>`
      SELECT merchant, amount::text, transaction_date::text, external_id
      FROM core.transactions WHERE account_id = ${accountId} ORDER BY external_id, transaction_date
    `.execute(trx)
    return r.rows
  })
}

beforeAll(async () => {
  h = await createHarness()
  const { seedBundledPlugins } = await import('./registry.js')
  await seedBundledPlugins(h.db)
  user = await createUser(h)
  other = await createUser(h)
})
afterAll(async () => { await h.close() })
afterEach(() => { vi.useRealTimers() })

describe('begin', () => {
  it('opens an upload and says what it holds', async () => {
    const res = await begin(user, 3, 100)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ uploadId: expect.any(String), chunks: 3, bytes: 100, expiresInSeconds: 900 })
  })

  it('refuses a chunk count or size outside the limits, or that cannot fit together', async () => {
    for (const [chunks, bytes] of [[0, 10], [65, 1000], [1, 0], [1, 8_000_001], [10, 5]] as const) {
      const res = await begin(other, chunks, bytes)
      expect(res.statusCode, `${chunks}/${bytes}`).toBe(400)
      expect(res.json()).toMatchObject({ code: 'import_failed' })
    }
    expect((await post('/upload/begin', { chunks: 'x', bytes: 5 }, other)).statusCode).toBe(400)
    expect((await post('/upload/begin', {}, other)).statusCode).toBe(400)
    // The largest allowed upload is accepted (64 chunks, 8,000,000 bytes); remove it by letting the next test use another user.
    expect((await begin(await createUser(h), 64, 8_000_000)).statusCode).toBe(200)
  })

  it('allows two live uploads per user, refuses a third with 409, and counts users separately', async () => {
    const u = await createUser(h)
    expect((await begin(u, 1, 10)).statusCode).toBe(200)
    expect((await begin(u, 1, 10)).statusCode).toBe(200)
    const third = await begin(u, 1, 10)
    expect(third.statusCode).toBe(409)
    expect(third.json()).toMatchObject({ code: 'too_many_uploads' })
    expect((await begin(await createUser(h), 1, 10)).statusCode).toBe(200)
  })
})

describe('chunk and finish', () => {
  it('takes chunks in any order, and the same chunk twice', async () => {
    const u = await createUser(h)
    const opened = (await begin(u, 3, 9)).json() as { uploadId: string }
    expect((await chunk(u, opened.uploadId, 2, 'ccc')).json()).toEqual({ chunks: 3, received: 1, bytes: 3 })
    expect((await chunk(u, opened.uploadId, 0, 'aaa')).json()).toEqual({ chunks: 3, received: 2, bytes: 6 })
    expect((await chunk(u, opened.uploadId, 0, 'aaa')).json()).toEqual({ chunks: 3, received: 2, bytes: 6 })
    const conflict = await chunk(u, opened.uploadId, 0, 'xxx')
    expect(conflict.statusCode).toBe(409)
    expect(conflict.json()).toMatchObject({ code: 'chunk_conflict' })
    expect((await chunk(u, opened.uploadId, 1, 'bbb')).json()).toEqual({ chunks: 3, received: 3, bytes: 9 })
    expect((await finish(u, opened.uploadId)).json()).toEqual({ chunks: 3, received: 3, bytes: 9 })
    expect((await finish(u, opened.uploadId)).statusCode).toBe(200)
  })

  it('refuses a chunk over 256 KiB without storing it, and a request body over the route limit', async () => {
    const u = await createUser(h)
    const { uploadId } = (await begin(u, 2, MAX_CHUNK_BYTES + 10)).json() as { uploadId: string }
    const big = await chunk(u, uploadId, 0, 'a'.repeat(MAX_CHUNK_BYTES + 1))
    expect(big.statusCode).toBe(413)
    expect(big.json()).toMatchObject({ code: 'chunk_too_large' })
    expect((await chunk(u, uploadId, 0, 'a'.repeat(MAX_CHUNK_BYTES))).json()).toMatchObject({ received: 1 })
    expect((await chunk(u, uploadId, 1, 'a'.repeat(1_100_000))).statusCode).toBe(413)
  })

  it('refuses an index outside the declared range, and empty or missing text', async () => {
    const u = await createUser(h)
    const { uploadId } = (await begin(u, 2, 10)).json() as { uploadId: string }
    for (const index of [-1, 2, 64, 0.5]) expect((await chunk(u, uploadId, index, 'abc')).statusCode, String(index)).toBe(400)
    expect((await chunk(u, uploadId, 0, '')).statusCode).toBe(400)
    expect((await post('/upload/chunk', { uploadId, index: 0 }, u)).statusCode).toBe(400)
    expect((await post('/upload/chunk', { uploadId: 'nope', index: 0, text: 'a' }, u)).statusCode).toBe(400)
  })

  it('refuses a chunk that takes the upload past the size it declared, as it arrives, and discards the upload', async () => {
    const u = await createUser(h)
    const { uploadId } = (await begin(u, 3, 10)).json() as { uploadId: string }
    expect((await chunk(u, uploadId, 0, 'aaaaaa')).statusCode).toBe(200)
    const over = await chunk(u, uploadId, 1, 'bbbbb')
    expect(over.statusCode).toBe(413)
    expect(over.json()).toMatchObject({ code: 'upload_too_large' })
    expect((await chunk(u, uploadId, 1, 'bb')).json()).toMatchObject(NOT_FOUND)
    // The quota came back with it.
    expect((await begin(u, 1, 5)).statusCode).toBe(200)
    expect((await begin(u, 1, 5)).statusCode).toBe(200)
  })

  it('refuses finish with a missing chunk, names it, and accepts it once the chunk is sent', async () => {
    const u = await createUser(h)
    const { uploadId } = (await begin(u, 3, 9)).json() as { uploadId: string }
    await chunk(u, uploadId, 0, 'aaa')
    await chunk(u, uploadId, 2, 'ccc')
    const missing = await finish(u, uploadId)
    expect(missing.statusCode).toBe(409)
    expect(missing.json()).toMatchObject({ code: 'upload_incomplete', message: expect.stringMatching(/first missing: 1/) as string })
    expect((await chunk(u, uploadId, 1, 'bbb')).statusCode).toBe(200)
    expect((await finish(u, uploadId)).statusCode).toBe(200)
  })

  it('refuses finish when the bytes are fewer than declared, and discards the upload', async () => {
    const u = await createUser(h)
    const { uploadId } = (await begin(u, 2, 20)).json() as { uploadId: string }
    await chunk(u, uploadId, 0, 'aaa')
    await chunk(u, uploadId, 1, 'bbb')
    const res = await finish(u, uploadId)
    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({ code: 'upload_size_mismatch' })
    expect((await finish(u, uploadId)).json()).toMatchObject(NOT_FOUND)
  })

  it('counts bytes of UTF-8, accepts a character cut between two chunks, and refuses a half that is never completed', async () => {
    const u = await createUser(h)
    const text = 'Date,Description,Amount\n03/04/2026,Café 😀 bar,-4.50'
    const cut = text.indexOf('\ud83d') + 1
    const a = (await begin(u, 2, Buffer.byteLength(text))).json() as { uploadId: string }
    expect((await chunk(u, a.uploadId, 0, text.slice(0, cut))).statusCode).toBe(200)
    expect((await chunk(u, a.uploadId, 1, text.slice(cut))).statusCode).toBe(200)
    expect((await finish(u, a.uploadId)).statusCode).toBe(200)

    const b = (await begin(u, 1, 2)).json() as { uploadId: string }
    expect((await chunk(u, b.uploadId, 0, '\ud83d')).statusCode).toBe(200)
    expect((await finish(u, b.uploadId)).json()).toMatchObject({ code: 'upload_not_text' })
  })
})

describe('another user\'s upload', () => {
  it('is answered exactly like an unknown id for chunk, finish, analyze and commit, and is left alone', async () => {
    const mine = await createUser(h)
    const theirs = await createUser(h)
    const theirAccount = await newAccount(theirs, 'Theirs')
    const csv = file(20, 'rls')
    const { uploadId } = (await begin(mine, 2, Buffer.byteLength(csv))).json() as { uploadId: string }
    const parts = pieces(csv, Math.ceil(csv.length / 2))
    await chunk(mine, uploadId, 0, parts[0] as string)

    const unknownId = '0b9a2f4e-7c1d-4e0a-9d63-5a1f2c3b4d5e'
    const unknown = await chunk(theirs, unknownId, 0, 'x')
    expect(unknown.statusCode).toBe(404)
    for (const res of [
      await chunk(theirs, uploadId, 1, parts[1] as string),
      await finish(theirs, uploadId),
      await post('/analyze', { accountId: theirAccount, uploadId, ...MAPPING }, theirs),
      await post('/commit', { accountId: theirAccount, uploadId, ...MAPPING, idempotencyKey: 'k' }, theirs),
    ]) {
      expect(res.statusCode).toBe(404)
      expect(res.json()).toEqual(unknown.json())
    }

    // Nothing they sent touched it: the owner finishes it, and it still holds the owner's own file only.
    expect((await chunk(mine, uploadId, 1, parts[1] as string)).statusCode).toBe(200)
    expect((await finish(mine, uploadId)).statusCode).toBe(200)
    const myAccount = await newAccount(mine, 'Mine')
    const analyzed = await post('/analyze', { accountId: myAccount, uploadId, ...MAPPING }, mine)
    expect(analyzed.json()).toMatchObject({ summary: { new: 20 } })
    // And their quota was not spent by trying.
    expect((await begin(theirs, 1, 5)).statusCode).toBe(200)
    expect((await begin(theirs, 1, 5)).statusCode).toBe(200)
    expect(await ledger(theirs, theirAccount)).toEqual([])
  })
})

describe('expiry', () => {
  it('ends an upload 15 minutes after its last new chunk, as an unknown id, and frees its quota', async () => {
    const u = await createUser(h)
    vi.useFakeTimers({ toFake: ['Date'] })
    const t0 = Date.now()
    const { uploadId } = (await begin(u, 2, 6)).json() as { uploadId: string }
    vi.setSystemTime(t0 + 14 * MINUTE)
    expect((await chunk(await freshToken(u), uploadId, 0, 'aaa')).statusCode).toBe(200)
    // 14 minutes after that chunk (28 after begin) it is still there...
    vi.setSystemTime(t0 + 28 * MINUTE)
    const later = await freshToken(u)
    expect((await chunk(later, uploadId, 0, 'aaa')).statusCode).toBe(200)
    // ...and 15 minutes after it, it is gone.
    vi.setSystemTime(t0 + 14 * MINUTE + 15 * MINUTE)
    const gone = await chunk(await freshToken(u), uploadId, 1, 'bbb')
    expect(gone.statusCode).toBe(404)
    expect(gone.json()).toMatchObject(NOT_FOUND)
    expect((await finish(await freshToken(u), uploadId)).statusCode).toBe(404)

    // Both live slots are free again.
    const t = await freshToken(u)
    expect((await begin(t, 1, 5)).statusCode).toBe(200)
    expect((await begin(t, 1, 5)).statusCode).toBe(200)
  })

  it('ends a finished upload that nobody imported, for analyze and commit alike', async () => {
    const u = await createUser(h)
    const accountId = await newAccount(u, 'Everyday')
    const uploadId = await stage(u, file(30, 'exp'))
    expect((await post('/analyze', { accountId, uploadId, ...MAPPING }, u)).statusCode).toBe(200)

    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 15 * MINUTE)
    const t = await freshToken(u)
    expect((await post('/analyze', { accountId, uploadId, ...MAPPING }, t)).json()).toMatchObject(NOT_FOUND)
    expect((await post('/commit', { accountId, uploadId, ...MAPPING }, t)).json()).toMatchObject(NOT_FOUND)
    expect(await ledger(u, accountId)).toEqual([])
  })
})

describe('analyze and commit by uploadId', () => {
  it('analyzes a staged file exactly as it analyzes the same csv in the body, page by page', async () => {
    const u = await createUser(h)
    const accountId = await newAccount(u, 'Everyday')
    const csv = file(2_500, 'an')
    const uploadId = await stage(u, csv)
    for (const page of [{}, { flaggedOffset: 5, flaggedLimit: 10 }]) {
      const byBody = await post('/analyze', { accountId, csv, ...MAPPING, ...page }, u)
      const byId = await post('/analyze', { accountId, uploadId, ...MAPPING, ...page }, u)
      expect(byId.statusCode).toBe(200)
      expect(byId.json()).toEqual(byBody.json())
    }
    expect((await post('/analyze', { accountId, csv, ...MAPPING }, u)).json()).toMatchObject({ summary: { new: 2_500 } })
  })

  it('refuses csv and uploadId together, a bad uploadId, and an upload that has not finished', async () => {
    const u = await createUser(h)
    const accountId = await newAccount(u, 'Everyday')
    const csv = file(5, 'bad')
    const uploadId = await stage(u, csv)
    const both = await post('/analyze', { accountId, uploadId, csv, ...MAPPING }, u)
    expect(both.statusCode).toBe(400)
    expect(both.json()).toMatchObject({ issues: [{ path: ['uploadId'] }] })
    expect((await post('/analyze', { accountId, uploadId: 'nope', ...MAPPING }, u)).statusCode).toBe(400)
    expect((await post('/commit', { accountId, uploadId, csv, ...MAPPING }, u)).statusCode).toBe(400)

    const open = (await begin(u, 1, 5)).json() as { uploadId: string }
    const unfinished = await post('/analyze', { accountId, uploadId: open.uploadId, ...MAPPING }, u)
    expect(unfinished.statusCode).toBe(409)
    expect(unfinished.json()).toMatchObject({ code: 'upload_incomplete' })
  })

  it('applies the same validation to a staged file: blank text, no rows, an unknown account', async () => {
    const u = await createUser(h)
    const accountId = await newAccount(u, 'Everyday')
    const blank = await stage(u, '   \n  ', 3)
    const blankRes = await post('/analyze', { accountId, uploadId: blank, ...MAPPING }, u)
    expect(blankRes.statusCode).toBe(400)
    expect(blankRes.json()).toMatchObject({ issues: [{ path: ['csv'] }] })
    const real = await stage(u, file(3, 'v'))
    expect((await post('/analyze', { accountId: '00000000-0000-4000-8000-000000000000', uploadId: real, ...MAPPING }, u)).statusCode).toBe(404)
  })

  it('commits a staged file to the same rows and summary as the same csv in the body, first import and repeat', async () => {
    const u = await createUser(h)
    const byBodyAccount = await newAccount(u, 'By body')
    const byIdAccount = await newAccount(u, 'By id')
    const csv = file(3_000, 'cm')

    const first = await post('/commit', { accountId: byBodyAccount, csv, fileName: 'f.csv', ...MAPPING }, u)
    const firstId = await stage(u, csv)
    const firstStaged = await post('/commit', { accountId: byIdAccount, uploadId: firstId, fileName: 'f.csv', ...MAPPING }, u)
    expect(first.statusCode).toBe(200)
    expect(first.json()).toMatchObject({ imported: 3_000, skipped: 0, failed: 0 })
    const strip = (r: { json: () => unknown }) => ({ ...(r.json() as Record<string, unknown>), batchId: undefined })
    expect(strip(firstStaged)).toEqual(strip(first))
    expect(await ledger(u, byIdAccount)).toEqual(await ledger(u, byBodyAccount))

    // The same file again: every row is now a duplicate, by either route.
    const second = await post('/commit', { accountId: byBodyAccount, csv, ...MAPPING }, u)
    const secondId = await stage(u, csv)
    const secondStaged = await post('/commit', { accountId: byIdAccount, uploadId: secondId, ...MAPPING }, u)
    expect(second.json()).toMatchObject({ imported: 0, skipped: 3_000 })
    expect(strip(secondStaged)).toEqual(strip(second))
    expect(await ledger(u, byIdAccount)).toEqual(await ledger(u, byBodyAccount))
  })

  it('frees the upload when its commit succeeds, and keeps it when the commit fails', async () => {
    const u = await createUser(h)
    const accountId = await newAccount(u, 'Everyday')
    const uploadId = await stage(u, file(40, 'rm'))

    // A commit that fails (an account that is not the user's) leaves the upload for another try.
    const refused = await post('/commit', { accountId: '00000000-0000-4000-8000-000000000000', uploadId, ...MAPPING }, u)
    expect(refused.statusCode).toBe(404)
    expect(refused.json()).toMatchObject({ code: 'not_found' })
    expect((await post('/analyze', { accountId, uploadId, ...MAPPING }, u)).statusCode).toBe(200)

    expect((await post('/commit', { accountId, uploadId, ...MAPPING }, u)).json()).toMatchObject({ imported: 40 })
    const after = await post('/commit', { accountId, uploadId, ...MAPPING }, u)
    expect(after.statusCode).toBe(404)
    expect(after.json()).toMatchObject(NOT_FOUND)
    expect((await post('/analyze', { accountId, uploadId, ...MAPPING }, u)).json()).toMatchObject(NOT_FOUND)
    // Both slots are free.
    expect((await begin(u, 1, 5)).statusCode).toBe(200)
    expect((await begin(u, 1, 5)).statusCode).toBe(200)
  })

  it('keeps a retry of a commit with the same uploadId and key idempotent, even after the upload is freed', async () => {
    const u = await createUser(h)
    const accountId = await newAccount(u, 'Everyday')
    const uploadId = await stage(u, file(60, 'idem'))
    const body = { accountId, uploadId, idempotencyKey: 'commit-key-1', ...MAPPING }

    const first = await post('/commit', body, u)
    expect(first.json()).toMatchObject({ imported: 60 })
    const retry = await post('/commit', body, u)
    expect(retry.statusCode).toBe(200)
    expect(retry.json()).toEqual({ ...(first.json() as object), replayed: true })
    expect(await ledger(u, accountId)).toHaveLength(60)

    // A different key, or no key, for an upload that was imported is not a retry.
    expect((await post('/commit', { ...body, idempotencyKey: 'another-key' }, u)).json()).toMatchObject(NOT_FOUND)
    expect((await post('/commit', { ...body, idempotencyKey: undefined }, u)).json()).toMatchObject(NOT_FOUND)
    // Another user cannot replay it.
    const theirs = await createUser(h)
    expect((await post('/commit', { ...body, accountId: await newAccount(theirs, 'T') }, theirs)).json()).toMatchObject(NOT_FOUND)
    expect(await ledger(u, accountId)).toHaveLength(60)
  })

  it('answers two commits of one upload at once, with one key, as one import', async () => {
    const u = await createUser(h)
    const accountId = await newAccount(u, 'Everyday')
    const uploadId = await stage(u, file(500, 'race'))
    const body = { accountId, uploadId, idempotencyKey: 'race-key', ...MAPPING }
    const [a, b] = await Promise.all([post('/commit', body, u), post('/commit', body, u)])
    expect([a.statusCode, b.statusCode]).toEqual([200, 200])
    expect([a, b].filter((r) => (r.json() as { replayed?: boolean }).replayed === true)).toHaveLength(1)
    expect(await ledger(u, accountId)).toHaveLength(500)
  })

  it('still accepts the csv body, with no staging involved', async () => {
    const u = await createUser(h)
    const accountId = await newAccount(u, 'Everyday')
    const res = await post('/commit', { accountId, csv: file(10, 'body'), ...MAPPING }, u)
    expect(res.json()).toMatchObject({ imported: 10 })
  })
})

describe('the staging space across all users', () => {
  let capped: Harness
  beforeAll(async () => { capped = await createHarness() })
  afterAll(async () => { await capped.close() })

  const send = (u: TestUser, path: string, payload: Record<string, unknown>) =>
    capped.app.inject({ method: 'POST', url: `${BASE}${path}`, headers: headers(u), payload })

  it('refuses a begin past 64,000,000 declared bytes with 503 and Retry-After, before any data is sent, and recovers as space frees', async () => {
    // Its own app, so no other test's uploads hold space. Eight uploads of the largest size fill it.
    const users = [] as TestUser[]
    for (let i = 0; i < 5; i += 1) users.push(await createUser(capped))
    const held: Array<{ user: TestUser; uploadId: string }> = []
    for (const u of users.slice(0, 4)) {
      for (let i = 0; i < 2; i += 1) {
        const res = await send(u, '/upload/begin', { chunks: 64, bytes: 8_000_000 })
        expect(res.statusCode, res.body).toBe(200)
        held.push({ user: u, uploadId: (res.json() as { uploadId: string }).uploadId })
      }
    }
    const fifth = users[4] as TestUser
    const refused = await send(fifth, '/upload/begin', { chunks: 1, bytes: 1 })
    expect(refused.statusCode).toBe(503)
    expect(refused.json()).toMatchObject({ code: 'staging_full' })
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0)

    // Space comes back when uploads expire (15 minutes on), and not before.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 15 * MINUTE)
    const later = await freshToken(fifth)
    const again = await send(later, '/upload/begin', { chunks: 1, bytes: 1 })
    expect(again.statusCode, again.body).toBe(200)
    expect(held).toHaveLength(8)
  })
})
