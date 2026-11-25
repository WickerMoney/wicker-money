import { ExplainNode, SelectQueryNode, sql, type KyselyPlugin } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, type Db } from '../client.js'
import { auth, createHarness, createUser, TEST_ADMIN_DATABASE_URL, type Harness, type TestUser } from '../../testing/harness.js'
import { KyselyTransactionRepository } from '../../transactions/repository/KyselyTransactionRepository.js'
import type { TransactionListCriteria } from '../../transactions/repository/TransactionListCriteria.js'
import { down, up } from './038_drop_unused_merchant_trgm_index.js'

/**
 * Migration 038: `core.ix_transactions_merchant_trgm` is dropped.
 *
 * Covers what only the migration does: the index is absent after `up` and
 * present, with exactly the definition migration 015 gave it, after `down`;
 * `pg_trgm` stays installed; a second `up` is a no-op; and nothing depended on
 * the index, which is the reason it can go. For that last point the same
 * merchant searches (every sort, both directions, paged) run on a ledger with
 * data before the drop, after it and after the index is restored, and must give
 * the same rows in the same order. The plan of the search as the application
 * role (row-level security applies) must not use the index while it exists,
 * because `ILIKE` is not leakproof. `down` and `up` run on the shared test
 * database and the test puts the schema back before it ends; test files run one
 * at a time.
 */
let h: Harness
let owner: Db
let user: TestUser

const INDEX = 'ix_transactions_merchant_trgm'
const ORIGINAL_DEFINITION =
  'CREATE INDEX ix_transactions_merchant_trgm ON core.transactions USING gin (merchant gin_trgm_ops)'

const indexDefinition = async (): Promise<string | undefined> =>
  (await sql<{ def: string }>`
    SELECT indexdef AS def FROM pg_indexes WHERE schemaname = 'core' AND indexname = ${INDEX}
  `.execute(owner)).rows[0]?.def

const trigramInstalled = async (): Promise<boolean> =>
  (await sql<{ n: number }>`SELECT count(*)::int AS n FROM pg_extension WHERE extname = 'pg_trgm'`.execute(owner)).rows[0]?.n === 1

const MERCHANTS = [
  'Amazon Marketplace', 'AMAZON PRIME', 'amazon web services', 'Shell Oil', 'Shelly Cafe', 'Planet Fitness Subscription',
  'Planet Fitness', 'Zelle Transfer', 'Zeldas Diner', '50% off sale', '50X off sale', 'under_score', 'underXscore',
  'back\\slash', 'Whole Foods', 'Whole Foods Market', 'Trader Joes', 'Target', 'Costco Wholesale', 'Netflix',
]

/** `search` terms, chosen to hit many rows, one row, a wildcard character and nothing. */
const TERMS = ['amazo', 'planet fitness subscription', 'zel', 'whole', '%', '_', '\\', 'no-such-merchant']

const SORTS = ['date', 'merchant', 'amount'] as const

beforeAll(async () => {
  h = await createHarness()
  owner = createDb(TEST_ADMIN_DATABASE_URL)
  user = await createUser(h)
  const account = (await h.app.inject({
    method: 'POST', url: '/api/v1/accounts', headers: auth(user), payload: { name: 'Trgm', accountType: 'checking' },
  })).json() as { id: string }
  // Several rows per merchant, so ties in the sort column are broken by the id.
  for (let i = 0; i < 60; i++) {
    const res = await h.app.inject({
      method: 'POST', url: '/api/v1/transactions', headers: auth(user),
      payload: {
        accountId: account.id,
        amount: `-${(i % 17) + 1}.${String(i % 100).padStart(2, '0')}`,
        merchant: MERCHANTS[i % MERCHANTS.length],
        transactionDate: `2026-03-${String((i % 28) + 1).padStart(2, '0')}`,
      },
    })
    expect(res.statusCode).toBe(201)
  }
})

afterAll(async () => {
  await up(owner) // the schema as the migrations leave it, whatever a failure interrupted
  await owner.destroy()
  await h.close()
})

/** Every search, every sort and direction, first and second page, as the ids in the order returned. */
async function searchResults(): Promise<Record<string, string[]>> {
  const results: Record<string, string[]> = {}
  for (const term of TERMS) {
    for (const sort of SORTS) {
      for (const direction of ['asc', 'desc']) {
        const pages: string[] = []
        let cursor = ''
        for (let page = 0; page < 3; page++) {
          const res = await h.app.inject({
            method: 'GET',
            url: `/api/v1/transactions?search=${encodeURIComponent(term)}&sort=${sort}&direction=${direction}&limit=7${cursor}`,
            headers: auth(user),
          })
          expect(res.statusCode).toBe(200)
          const body = res.json() as { items: Array<{ id: string; merchant: string }>; nextCursor?: string | null }
          pages.push(...body.items.map((t) => `${t.id}:${t.merchant}`))
          if (body.nextCursor === undefined || body.nextCursor === null) break
          cursor = `&cursor=${encodeURIComponent(body.nextCursor)}`
        }
        results[`${term}|${sort}|${direction}`] = pages
      }
    }
  }
  return results
}

/** Rewrites `select` statements into `EXPLAIN (FORMAT JSON)` so `listPage` returns the plan. */
const explainSelects: KyselyPlugin = {
  transformQuery: ({ node }) => (SelectQueryNode.is(node) ? { ...node, explain: ExplainNode.create('json') } : node),
  transformResult: async ({ result }) => result,
}

interface PlanNode {
  'Node Type': string
  'Index Name'?: string
  Filter?: string
  Plans?: PlanNode[]
}

const nodesOf = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(nodesOf)]

/** The plan of the merchant search as the application role, with sequential scans off to give an index every chance. */
async function planFor(criteria: TransactionListCriteria): Promise<PlanNode[]> {
  return asUser(h.db, user.id, async (trx) => {
    await sql`SET LOCAL enable_seqscan = off`.execute(trx)
    const repository = new KyselyTransactionRepository(trx.withPlugin(explainSelects))
    const { items } = await repository.listPage(criteria)
    return nodesOf((items[0] as unknown as Record<string, { Plan: PlanNode }[]>)['QUERY PLAN']![0]!.Plan)
  })
}

describe('up', () => {
  it('leaves the index absent and pg_trgm installed', async () => {
    expect(await indexDefinition()).toBeUndefined()
    expect(await trigramInstalled()).toBe(true)
  })

  it('is a no-op on a second run', async () => {
    await up(owner)
    expect(await indexDefinition()).toBeUndefined()
  })
})

describe('down and up on a ledger with data', () => {
  it('restores the exact 015 definition, and search results and their order are the same with and without the index', async () => {
    const withoutIndex = await searchResults()
    expect(withoutIndex['amazo|date|desc']?.length).toBeGreaterThan(0)
    expect(withoutIndex['no-such-merchant|date|desc']).toEqual([])

    try {
      await down(owner)
      expect(await indexDefinition()).toBe(ORIGINAL_DEFINITION)
      expect(await trigramInstalled()).toBe(true)
      await down(owner) // a second down is a no-op too
      expect(await indexDefinition()).toBe(ORIGINAL_DEFINITION)

      expect(await searchResults()).toEqual(withoutIndex)

      // The index exists and still is not used: ILIKE is not leakproof, so under row-level security it stays a filter.
      for (const sort of SORTS) {
        const nodes = await planFor({ sort, direction: 'desc', limit: 51, search: 'amazo' })
        const types = nodes.map((n) => n['Node Type'])
        expect(nodes.some((n) => n['Index Name'] === INDEX), `${sort}: plan used ${types.join(' > ')}`).toBe(false)
        expect(nodes.some((n) => (n.Filter ?? '').includes('~~*')), `${sort}: ILIKE is a filter`).toBe(true)
      }
    } finally {
      await up(owner)
    }

    expect(await indexDefinition()).toBeUndefined()
    expect(await searchResults()).toEqual(withoutIndex)
  })
})
