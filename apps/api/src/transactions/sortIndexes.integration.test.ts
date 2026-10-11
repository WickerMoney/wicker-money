import { ExplainNode, SelectQueryNode, sql, type KyselyPlugin } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asUser } from '../db/client.js'
import { createHarness, createUser, type Harness, type TestUser } from '../testing/harness.js'
import { KyselyTransactionRepository } from './repository/KyselyTransactionRepository.js'
import type { TransactionListCriteria } from './repository/TransactionListCriteria.js'

/**
 * Pins the plan shape of the transaction list: for the merchant and amount
 * sorts the database hands the rows over in the requested order from an index,
 * with no sort step. That is what migration 031 exists for, and an unnoticed
 * change to the ordering or to the indexes would bring the sort back without
 * failing any result-checking test.
 *
 * The statement under test is the one the repository really sends. A Kysely
 * plugin turns the `select` into `EXPLAIN (FORMAT JSON)` on its way out, so
 * the plan comes from `listPage` itself rather than from a copy of its query.
 * Sorts are switched off for the transaction (plus sequential scans, which
 * would otherwise win on an almost empty table), so the only plans left are
 * those where an index provides the order. A planner's cost choices on a
 * large table are measured, not asserted; see the migration's pull request.
 */
let h: Harness
let user: TestUser

/** Rewrites `select` statements into `EXPLAIN (FORMAT JSON)` so `listPage` returns the plan. */
const explainSelects: KyselyPlugin = {
  transformQuery: ({ node }) => (SelectQueryNode.is(node) ? { ...node, explain: ExplainNode.create('json') } : node),
  transformResult: async ({ result }) => result,
}

interface PlanNode {
  'Node Type': string
  'Index Name'?: string
  'Index Cond'?: string
  Plans?: PlanNode[]
}

/** Every node of a plan tree, parents before children. */
function nodesOf(node: PlanNode): PlanNode[] {
  return [node, ...(node.Plans ?? []).flatMap(nodesOf)]
}

/** Plans one `listPage` call as the test user, with sorts and sequential scans disabled. */
async function planFor(criteria: TransactionListCriteria): Promise<PlanNode[]> {
  return asUser(h.db, user.id, async (trx) => {
    await sql`SET LOCAL enable_seqscan = off`.execute(trx)
    await sql`SET LOCAL enable_sort = off`.execute(trx)
    await sql`SET LOCAL enable_incremental_sort = off`.execute(trx)
    const repository = new KyselyTransactionRepository(trx.withPlugin(explainSelects))
    const { items } = await repository.listPage(criteria)
    const plan = (items[0] as unknown as Record<string, { Plan: PlanNode }[]>)['QUERY PLAN']![0]!.Plan
    return nodesOf(plan)
  })
}

beforeAll(async () => {
  h = await createHarness()
  user = await createUser(h)
})
afterAll(async () => { await h.close() })

/** The index each sort is expected to be read from. */
const SORT_INDEXES = [
  { sort: 'merchant', index: 'ix_transactions_user_merchant_id' },
  { sort: 'amount', index: 'ix_transactions_user_amount_id' },
] as const

describe('transaction list sort indexes', () => {
  for (const { sort, index } of SORT_INDEXES) {
    for (const direction of ['asc', 'desc'] as const) {
      it(`reads the first page of ${sort} ${direction} from ${index} without a sort step`, async () => {
        const nodes = await planFor({ sort, direction, limit: 50 })
        const types = nodes.map((n) => n['Node Type'])

        expect(nodes.some((n) => n['Index Name'] === index), `plan used: ${types.join(' > ')}`).toBe(true)
        expect(types.filter((t) => t.includes('Sort'))).toEqual([])
      })
    }
  }

  it('turns the keyset position of a merchant page into an index condition', async () => {
    // Text comparison is leakproof, so under row-level security the
    // predicate can bound the index scan instead of filtering rows after it.
    const nodes = await planFor({
      sort: 'merchant',
      direction: 'asc',
      limit: 50,
      after: { value: 'Corner Shop', id: '00000000-0000-4000-8000-000000000000' },
    })
    const scan = nodes.find((n) => n['Index Name'] === 'ix_transactions_user_merchant_id')

    expect(scan, `plan used: ${nodes.map((n) => n['Node Type']).join(' > ')}`).toBeDefined()
    expect(scan?.['Index Cond']).toContain('merchant')
  })
})
