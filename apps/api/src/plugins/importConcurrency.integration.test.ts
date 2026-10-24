import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { auth, createHarness, createUser, type Harness, type TestUser } from '../testing/harness.js'

const PLUGIN = 'wickermoney.import-csv'
const BASE = `/api/v1/p/${PLUGIN}`

const MAPPING = {
  sourceName: 'Test Bank',
  columns: { date: 'Date', merchant: 'Description', amount: 'Amount', externalId: 'Id' },
  dateFormat: 'MM/DD/YYYY',
  amountStyle: 'signed',
  invertAmount: false,
}

/** A file of `rows` distinct rows, large enough that a commit takes a moment. */
function file(rows: number, tag: string): string {
  const lines = ['Date,Description,Amount,Id']
  for (let i = 0; i < rows; i += 1) {
    const day = String((i % 28) + 1).padStart(2, '0')
    lines.push(`03/${day}/2026,MERCHANT ${i % 331} ${tag},-${Math.floor(i / 100) + 1}.${String(i % 100).padStart(2, '0')},${tag}-${i}`)
  }
  return lines.join('\n')
}

interface Importer { readonly user: TestUser; readonly accountId: string }

async function importer(h: Harness): Promise<Importer> {
  const user = await createUser(h)
  const res = await h.app.inject({
    method: 'POST', url: '/api/v1/accounts', headers: auth(user),
    payload: { name: 'Everyday', accountType: 'checking', openingBalance: '0.00' },
  })
  if (res.statusCode !== 201) throw new Error(`account failed: ${res.statusCode} ${res.body}`)
  return { user, accountId: (res.json() as { id: string }).id }
}

function commit(h: Harness, who: Importer, csv: string) {
  return h.app.inject({
    method: 'POST', url: `${BASE}/commit`,
    headers: { ...auth(who.user), 'x-wickermoney-plugin': PLUGIN },
    payload: { accountId: who.accountId, csv, fileName: 'big.csv', acceptRowNumbers: [], idempotencyKey: `k-${who.accountId}`, ...MAPPING },
  })
}

describe('concurrent imports on a small pool', () => {
  // Four connections, two imports at a time: the other two stay free for everything else.
  let h: Harness
  beforeAll(async () => {
    h = await createHarness({ DB_POOL_MAX: '4', IMPORT_MAX_CONCURRENT: '2', IMPORT_QUEUE_WAIT_SECONDS: '120' })
    const { seedBundledPlugins } = await import('./registry.js')
    await seedBundledPlugins(h.db)
  })
  afterAll(async () => { await h.close() })

  it('serves other requests while more imports than the limit are committing, and finishes them all', async () => {
    const people = await Promise.all(Array.from({ length: 6 }, () => importer(h)))
    const reader = await createUser(h)

    let running = true
    const statuses: number[] = []
    const slowest: number[] = []
    const probes = (async () => {
      while (running) {
        for (const request of [
          () => h.app.inject({ method: 'GET', url: '/readyz' }),
          () => h.app.inject({ method: 'GET', url: '/api/v1/accounts', headers: auth(reader) }),
        ]) {
          const started = performance.now()
          const res = await request()
          slowest.push(performance.now() - started)
          statuses.push(res.statusCode)
        }
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
    })()

    const results = await Promise.all(people.map((p, i) => commit(h, p, file(25_000, `p${i}`))))
    running = false
    await probes

    expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200, 200, 200, 200])
    expect(results.map((r) => (r.json() as { imported: number }).imported)).toEqual(Array(6).fill(25_000))
    expect(statuses.length).toBeGreaterThan(10)
    expect(statuses.every((s) => s === 200)).toBe(true)
    // Nobody waited anywhere near the pool's 5 second connection timeout.
    expect(Math.max(...slowest)).toBeLessThan(4_000)
  }, 120_000)
})

describe('an import that cannot get a turn', () => {
  let h: Harness
  beforeAll(async () => {
    h = await createHarness({ IMPORT_MAX_CONCURRENT: '1', IMPORT_QUEUE_WAIT_SECONDS: '0' })
    const { seedBundledPlugins } = await import('./registry.js')
    await seedBundledPlugins(h.db)
  })
  afterAll(async () => { await h.close() })

  it('is refused with 503, import_busy and Retry-After, writes nothing, and succeeds when sent again', async () => {
    const [a, b] = await Promise.all([importer(h), importer(h)])
    const [first, second] = [file(20_000, 'a'), file(20_000, 'b')]
    const both = await Promise.all([commit(h, a, first), commit(h, b, second)])

    const refused = both.filter((r) => r.statusCode === 503)
    const done = both.filter((r) => r.statusCode === 200)
    expect(refused).toHaveLength(1)
    expect(done).toHaveLength(1)
    const [busy] = refused
    expect(busy?.json()).toMatchObject({ code: 'import_busy' })
    expect((busy?.json() as { message: string }).message).toMatch(/Nothing was imported\. Try again in about \d+ seconds/)
    expect(Number(busy?.headers['retry-after'])).toBeGreaterThan(0)

    // The refused person retries (same file, same key) and is imported once the other is done.
    const loser = both[0]?.statusCode === 503 ? a : b
    const retry = await commit(h, loser, both[0]?.statusCode === 503 ? first : second)
    expect(retry.statusCode).toBe(200)
    expect(retry.json()).toMatchObject({ imported: 20_000 })
  }, 60_000)
})
