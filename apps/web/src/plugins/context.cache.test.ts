import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PluginManifest } from '@wickermoney/plugin-sdk'
import { api, setAccessToken } from '../api/client.js'
import { responseCache, RESPONSE_CACHE_MAX_ENTRIES, RESPONSE_CACHE_TTL_MS } from '../api/responseCache.js'
import { buildPluginContext } from './context.js'

// These tests run the real client and cache against a stubbed `fetch`, so they
// cover the whole path a plugin's `ctx.api` takes, including what a write does.

const SUMMARY = '/core/transactions/monthly-summary?months=12'

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** An unsigned JWT-shaped token for one user, valid for ten minutes. */
function tokenFor(sub: string): string {
  const payload = btoa(JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + 600 }))
  return `h.${payload.replace(/=+$/, '')}.s`
}

function manifest(id: string): PluginManifest {
  return {
    id,
    name: id,
    version: '0.1.0',
    description: '',
    author: '',
    sdkVersion: 0,
    permissions: [],
    remoteEntry: '',
    requiredTables: [{ table: 'transactions', access: 'read' }],
    contributes: { widgets: [], pages: [] },
  } as unknown as PluginManifest
}

const userOf = (id: string) => ({ id, email: `${id}@example.com`, timezone: 'UTC', role: 'member' as const })
const contextFor = (userId: string, pluginId = 'wickermoney.insights') =>
  buildPluginContext(manifest(pluginId), userOf(userId), () => {})

interface Pending {
  readonly url: string
  readonly init: RequestInit
  readonly respond: (body: unknown, status?: number) => void
}

let fetchMock: ReturnType<typeof vi.fn<(url: string, init: RequestInit) => Promise<Response>>>
let pending: Pending[]

/** Answers every request at once with whatever `answer` returns for it. */
function autoAnswer(answer: (url: string, init: RequestInit) => unknown): void {
  fetchMock.mockImplementation(async (url, init) => json(answer(url, init)))
}

/** Holds every request open until the test answers it. */
function holdRequests(): void {
  fetchMock.mockImplementation(
    (url, init) => new Promise<Response>((resolve) => {
      pending.push({ url, init, respond: (body, status = 200) => resolve(json(body, status)) })
    }),
  )
}

const getsTo = (path: string): number => fetchMock.mock.calls.filter(([u]) => u === `/api/v1${path}`).length

beforeEach(() => {
  fetchMock = vi.fn()
  pending = []
  vi.stubGlobal('fetch', fetchMock)
  setAccessToken(tokenFor('u1'))
})

afterEach(() => {
  setAccessToken(null)
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('sharing reads between widgets', () => {
  it('collapses concurrent identical reads, even from different plugins, into one request', async () => {
    autoAnswer(() => ({ rows: [] }))
    const insights = contextFor('u1', 'wickermoney.insights')
    const trends = contextFor('u1', 'wickermoney.spending-trends')

    await Promise.all([insights.api.get(SUMMARY), insights.api.get(SUMMARY), trends.api.get(SUMMARY)])

    expect(getsTo(SUMMARY)).toBe(1)
  })

  it('sends the request under the first caller\'s plugin id', async () => {
    autoAnswer(() => ({}))
    await Promise.all([
      contextFor('u1', 'wickermoney.insights').api.get(SUMMARY),
      contextFor('u1', 'wickermoney.spending-trends').api.get(SUMMARY),
    ])

    const headers = new Headers(fetchMock.mock.calls[0]![1].headers)
    expect(headers.get('x-wickermoney-plugin')).toBe('wickermoney.insights')
  })

  it('treats a different query string as a different read', async () => {
    autoAnswer(() => ({}))
    const ctx = contextFor('u1')

    await Promise.all([ctx.api.get('/core/transactions/monthly-summary?months=3'), ctx.api.get(SUMMARY)])

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('gives each caller its own copy of the response', async () => {
    autoAnswer(() => ({ rows: [{ total: '1.00' }] }))
    const ctx = contextFor('u1')

    const [a, b] = await Promise.all([ctx.api.get<{ rows: { total: string }[] }>(SUMMARY), ctx.api.get<{ rows: { total: string }[] }>(SUMMARY)])
    a.rows[0]!.total = 'tampered'
    const later = await ctx.api.get<{ rows: { total: string }[] }>(SUMMARY)

    expect(b.rows[0]!.total).toBe('1.00')
    expect(later.rows[0]!.total).toBe('1.00')
  })

  it('does not cancel a shared request when one caller aborts', async () => {
    holdRequests()
    const ctx = contextFor('u1')
    const controller = new AbortController()

    const aborted = ctx.api.get(SUMMARY, { signal: controller.signal })
    const other = ctx.api.get(SUMMARY)
    controller.abort()
    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(pending).toHaveLength(1))
    pending[0]!.respond({ ok: true })

    await expect(other).resolves.toEqual({ ok: true })
    expect(pending[0]!.init.signal).toBeFalsy()
  })
})

describe('the short TTL', () => {
  it('serves a repeat read from memory until the TTL passes, then asks again', async () => {
    vi.useFakeTimers()
    autoAnswer(() => ({}))
    const ctx = contextFor('u1')

    await ctx.api.get(SUMMARY)
    vi.advanceTimersByTime(RESPONSE_CACHE_TTL_MS - 1)
    await ctx.api.get(SUMMARY)
    expect(getsTo(SUMMARY)).toBe(1)

    vi.advanceTimersByTime(1)
    await ctx.api.get(SUMMARY)
    expect(getsTo(SUMMARY)).toBe(2)
  })

  it('evicts beyond the entry cap', async () => {
    autoAnswer(() => ({}))
    const ctx = contextFor('u1')

    for (let n = 0; n <= RESPONSE_CACHE_MAX_ENTRIES; n += 1) {
      await ctx.api.get(`/core/transactions/monthly-summary?months=${n + 1}`)
    }

    expect(responseCache.size('u1')).toBe(RESPONSE_CACHE_MAX_ENTRIES)
    await ctx.api.get('/core/transactions/monthly-summary?months=1') // the oldest, evicted
    expect(getsTo('/core/transactions/monthly-summary?months=1')).toBe(2)
  })
})

describe('writes', () => {
  it('drop everything the user had remembered, whatever the endpoint', async () => {
    autoAnswer(() => ({}))
    const ctx = contextFor('u1')
    await ctx.api.get(SUMMARY)
    await ctx.api.get('/core/transactions/list')

    await ctx.api.post('/p/wickermoney.import-csv/commit', {})

    await ctx.api.get(SUMMARY)
    await ctx.api.get('/core/transactions/list')
    expect(getsTo(SUMMARY)).toBe(2)
    expect(getsTo('/core/transactions/list')).toBe(2)
  })

  it('include a write made by the host with the unscoped client', async () => {
    autoAnswer(() => ({}))
    const ctx = contextFor('u1')
    await ctx.api.get(SUMMARY)

    await api.patch('/transactions/1', { note: 'x' })

    await ctx.api.get(SUMMARY)
    expect(getsTo(SUMMARY)).toBe(2)
  })

  it('also drop a read that was in flight when the write happened', async () => {
    holdRequests()
    const ctx = contextFor('u1')

    const early = ctx.api.get(SUMMARY)
    await vi.waitFor(() => expect(pending).toHaveLength(1))
    const write = ctx.api.post('/p/wickermoney.budgets/line', {})
    await vi.waitFor(() => expect(pending).toHaveLength(2))
    pending[0]!.respond({ total: 'before the write' })
    pending[1]!.respond({})
    await Promise.all([early, write])

    const after = ctx.api.get(SUMMARY)
    await vi.waitFor(() => expect(pending).toHaveLength(3))
    pending[2]!.respond({ total: 'after the write' })

    await expect(after).resolves.toEqual({ total: 'after the write' })
  })
})

describe('users never share', () => {
  it('gives user B a request and an answer of their own for the identical URL', async () => {
    autoAnswer((_url, init) => ({ seenToken: new Headers(init.headers).get('authorization') }))
    const a = contextFor('A')
    setAccessToken(tokenFor('A'))
    const forA = await a.api.get<{ seenToken: string }>(SUMMARY)

    setAccessToken(tokenFor('B')) // B signs in within the TTL
    const forB = await contextFor('B').api.get<{ seenToken: string }>(SUMMARY)

    expect(getsTo(SUMMARY)).toBe(2)
    expect(forA.seenToken).toContain(tokenFor('A').split('.')[1])
    expect(forB.seenToken).toContain(tokenFor('B').split('.')[1])
    expect(forB).not.toEqual(forA)
  })

  it("survives a switch mid-flight: A's late answer is never given to B", async () => {
    holdRequests()
    setAccessToken(tokenFor('A'))
    const forA = contextFor('A').api.get(SUMMARY)
    await vi.waitFor(() => expect(pending).toHaveLength(1))

    setAccessToken(tokenFor('B'))
    const forB = contextFor('B').api.get(SUMMARY)
    await vi.waitFor(() => expect(pending).toHaveLength(2))
    pending[0]!.respond({ owner: 'A' })
    pending[1]!.respond({ owner: 'B' })

    await expect(forB).resolves.toEqual({ owner: 'B' })
    await expect(forA).resolves.toEqual({ owner: 'A' })
    // Nothing of A's was written back for B, nor B's for A.
    await expect(contextFor('B').api.get(SUMMARY)).resolves.toEqual({ owner: 'B' })
    expect(responseCache.size('A')).toBe(0)
    expect(getsTo(SUMMARY)).toBe(2)
  })

  it('keeps a context that outlived its user out of the cache', async () => {
    autoAnswer((_url, init) => ({ token: new Headers(init.headers).get('authorization') }))
    setAccessToken(tokenFor('A'))
    const staleForA = contextFor('A')
    setAccessToken(tokenFor('B'))

    await staleForA.api.get(SUMMARY) // goes out with B's token, so must not be filed under A

    expect(responseCache.size('A')).toBe(0)
    expect(responseCache.size('B')).toBe(0)
  })

  it('is emptied on logout', async () => {
    autoAnswer(() => ({}))
    await contextFor('u1').api.get(SUMMARY)

    setAccessToken(null)
    setAccessToken(tokenFor('u1'))

    await contextFor('u1').api.get(SUMMARY)
    expect(getsTo(SUMMARY)).toBe(2)
  })
})

describe('errors', () => {
  it('are shared by the callers waiting on them and then forgotten', async () => {
    holdRequests()
    const ctx = contextFor('u1')

    const first = ctx.api.get(SUMMARY)
    const second = ctx.api.get(SUMMARY)
    const settled = Promise.allSettled([first, second])
    await vi.waitFor(() => expect(pending).toHaveLength(1))
    pending[0]!.respond({ code: 'boom', message: 'Boom' }, 500)

    expect((await settled).map((r) => r.status)).toEqual(['rejected', 'rejected'])
    expect(responseCache.size('u1')).toBe(0)

    const retry = ctx.api.get(SUMMARY)
    await vi.waitFor(() => expect(pending).toHaveLength(2))
    pending[1]!.respond({ ok: true })
    await expect(retry).resolves.toEqual({ ok: true })
  })
})

describe('asking for a fresh read', () => {
  it.each(['no-store', 'reload'] as const)("goes to the network with cache: '%s' and drops the old answer", async (mode) => {
    let n = 0
    autoAnswer(() => ({ n: (n += 1) }))
    const ctx = contextFor('u1')
    await expect(ctx.api.get(SUMMARY)).resolves.toEqual({ n: 1 })

    await expect(ctx.api.get(SUMMARY, { cache: mode })).resolves.toEqual({ n: 2 })
    expect(fetchMock.mock.calls[1]![1].cache).toBe(mode)

    // The remembered answer is older than the fresh one, so it was dropped.
    await expect(ctx.api.get(SUMMARY)).resolves.toEqual({ n: 3 })
  })

  it('does not join a request already in flight', async () => {
    holdRequests()
    const ctx = contextFor('u1')

    const shared = ctx.api.get(SUMMARY)
    const fresh = ctx.api.get(SUMMARY, { cache: 'no-store' })
    await vi.waitFor(() => expect(pending).toHaveLength(2))
    pending[0]!.respond({ n: 1 })
    pending[1]!.respond({ n: 2 })

    await expect(shared).resolves.toEqual({ n: 1 })
    await expect(fresh).resolves.toEqual({ n: 2 })
  })

  it('is the default for calls with options that could change the answer', async () => {
    autoAnswer(() => ({}))
    const ctx = contextFor('u1')

    await ctx.api.get(SUMMARY, { headers: { accept: 'application/json' } })
    await ctx.api.get(SUMMARY, { headers: { accept: 'application/json' } })

    expect(getsTo(SUMMARY)).toBe(2)
    expect(responseCache.size('u1')).toBe(0)
  })
})
