import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, type Db } from '../client.js'
import { auth, createHarness, createUser, TEST_ADMIN_DATABASE_URL, type Harness, type TestUser } from '../../testing/harness.js'
import { withOwnerBackfillAccess, type Executor } from './support/index.js'
import { down, up } from './023_budget_windows.js'

/**
 * Migration 023: the overlap rule that makes budget windows safe, and the
 * `down` that backs the feature out.
 *
 * The `down` is tested in a transaction that is rolled back, so the shared
 * test database keeps the constraint every other suite relies on.
 */

const PLUGIN = 'wickermoney.budgets'
const BASE = `/api/v1/p/${PLUGIN}`

let h: Harness
let owner: Db
let alice: TestUser
let categoryId: string

/** Rolls a transaction back after the assertions inside it have run. */
class Rollback extends Error {}

const constraintExists = async (db: Executor): Promise<boolean> =>
  (await sql<{ n: number }>`
    SELECT count(*)::int AS n FROM pg_constraint
    WHERE conrelid = 'plugin_budgets.budget_lines'::regclass AND conname = 'ex_budget_lines_no_overlap'
  `.execute(db)).rows[0]?.n === 1

beforeAll(async () => {
  h = await createHarness()
  const { seedBundledPlugins } = await import('../../plugins/registry.js')
  await seedBundledPlugins(h.db)
  owner = createDb(TEST_ADMIN_DATABASE_URL)
  alice = await createUser(h)
  const res = await h.app.inject({
    method: 'POST', url: '/api/v1/categories', headers: auth(alice), payload: { name: 'Gifts', slug: 'gifts' },
  })
  categoryId = (res.json() as { id: string }).id

  const headers = { ...auth(alice), 'x-wickermoney-plugin': PLUGIN }
  await h.app.inject({
    method: 'PUT', url: `${BASE}/line`, headers,
    payload: { month: '2036-09', categoryId, planned: '10.0000', rollover: false },
  })
  await h.app.inject({
    method: 'PUT', url: `${BASE}/window`, headers,
    payload: { categoryId, start: '2036-10-01', through: '2036-12-25', planned: '900.0000' },
  })
})

afterAll(async () => {
  await owner.destroy()
  await h.close()
})

describe('up', () => {
  it('adds the overlap constraint', async () => {
    expect(await constraintExists(owner)).toBe(true)
  })

  it('is a no-op on a second run', async () => {
    await up(owner)
    expect(await constraintExists(owner)).toBe(true)
  })
})

describe('down', () => {
  it('deletes windows, keeps monthly lines and drops the constraint', async () => {
    const run = owner.transaction().execute(async (trx) => {
      await down(trx)

      const rows = await withOwnerBackfillAccess(trx, ['plugin_budgets.budget_lines'], async (t) =>
        (await sql<{ period_start: string; period_end: string }>`
          SELECT period_start::text, period_end::text FROM plugin_budgets.budget_lines
          WHERE user_id = ${alice.id} ORDER BY period_start
        `.execute(t)).rows)
      expect(rows).toEqual([{ period_start: '2036-09-01', period_end: '2036-10-01' }])
      expect(await constraintExists(trx)).toBe(false)
      throw new Rollback()
    })
    await expect(run).rejects.toBeInstanceOf(Rollback)
    expect(await constraintExists(owner)).toBe(true)
  })
})
