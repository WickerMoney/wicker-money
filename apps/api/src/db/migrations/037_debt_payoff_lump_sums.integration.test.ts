import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, type Db } from '../client.js'
import { createHarness, TEST_ADMIN_DATABASE_URL, type Harness } from '../../testing/harness.js'
import { withOwnerBackfillAccess, type Executor } from './support/index.js'
import { down, up } from './037_debt_payoff_lump_sums.js'

/**
 * Migration 037: lump sums for the debt payoff plugin.
 *
 * Behaviour through the API (CRUD, the allocation rules, isolation between two
 * people, the plan) is covered in `plugins/debtPayoff.integration.test.ts`. This
 * covers what only the migration does: the shape and the constraints, the
 * composite keys that keep an allocation from naming another person's debt, the
 * cascades, that debts and settings saved before it are untouched, and a `down`
 * that drops the two tables and keeps the debts. `down` runs in a rolled-back
 * transaction so the shared test database keeps the schema other suites rely on.
 */

let h: Harness
let owner: Db

class Rollback extends Error {}

const LUMP = 'plugin_debt_payoff.lump_sums'
const ALLOC = 'plugin_debt_payoff.lump_sum_allocations'
const TABLES = ['plugin_debt_payoff.debts', 'plugin_debt_payoff.plan_settings', LUMP, ALLOC] as const

const exists = async (db: Executor, table: string): Promise<boolean> =>
  (await sql<{ found: boolean }>`SELECT to_regclass(${table}) IS NOT NULL AS found`.execute(db)).rows[0]?.found === true

const constraintDef = async (db: Executor, table: string, name: string): Promise<string | undefined> =>
  (await sql<{ def: string }>`
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = ${name} AND conrelid = ${table}::regclass
  `.execute(db)).rows[0]?.def

async function newUser(trx: Executor, tag: string): Promise<string> {
  const user = (await sql<{ id: string }>`
    INSERT INTO core.users (email, password_hash) VALUES (${`m037-${tag}-${Math.random()}@example.test`}, 'x') RETURNING id
  `.execute(trx)).rows[0]
  if (user === undefined) throw new Error('no user')
  return user.id
}

/** Runs `work` as the owner with the transient backfill policy, so FORCEd tables can be read and written. */
const asOwner = <T>(trx: Executor, work: (t: Executor) => Promise<T>): Promise<T> =>
  withOwnerBackfillAccess(trx, TABLES, work)

const debtFor = async (t: Executor, userId: string, name: string): Promise<string> =>
  (await sql<{ id: string }>`
    INSERT INTO plugin_debt_payoff.debts (user_id, name, balance, apr, minimum_payment)
    VALUES (${userId}::uuid, ${name}, 100, 5, 10) RETURNING id
  `.execute(t)).rows[0]?.id ?? ''

const lumpFor = async (t: Executor, userId: string, amount = '250.5000'): Promise<string> =>
  (await sql<{ id: string }>`
    INSERT INTO plugin_debt_payoff.lump_sums (user_id, on_date, amount, note)
    VALUES (${userId}::uuid, '2027-01-15', ${amount}::numeric, 'bonus') RETURNING id
  `.execute(t)).rows[0]?.id ?? ''

const countOf = async (t: Executor, table: string, userId: string): Promise<number> =>
  (await sql<{ n: number }>`SELECT count(*)::int AS n FROM ${sql.raw(table)} WHERE user_id = ${userId}::uuid`.execute(t)).rows[0]?.n ?? -1

const rollsBack = async (work: (trx: Executor) => Promise<void>): Promise<void> => {
  const run = owner.transaction().execute(async (trx) => {
    await work(trx)
    throw new Rollback()
  })
  await expect(run).rejects.toBeInstanceOf(Rollback)
}

beforeAll(async () => {
  h = await createHarness()
  owner = createDb(TEST_ADMIN_DATABASE_URL)
})

afterAll(async () => {
  await owner.destroy()
  await h.close()
})

describe('up', () => {
  it('creates both tables under forced row-level security with the isolation policy', async () => {
    for (const table of [LUMP, ALLOC]) {
      const { rows } = await sql<{ enabled: boolean; forced: boolean }>`
        SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced FROM pg_class WHERE oid = to_regclass(${table})
      `.execute(owner)
      expect(rows[0], table).toEqual({ enabled: true, forced: true })
      const policy = await sql<{ qual: string; check: string }>`
        SELECT pg_get_expr(polqual, polrelid) AS qual, pg_get_expr(polwithcheck, polrelid) AS check
        FROM pg_policy WHERE polrelid = to_regclass(${table})
      `.execute(owner)
      expect(policy.rows, table).toHaveLength(1)
      expect(policy.rows[0]?.qual, table).toMatch(/user_id = \(\s*SELECT\s+(core\.)?current_user_id\(\)/)
      expect(policy.rows[0]?.check, table).toBe(policy.rows[0]?.qual)
    }
  })

  it('stores money as numeric(19,4) and the date as a date', async () => {
    const { rows } = await sql<{ rel: string; col: string; type: string }>`
      SELECT c.relname AS rel, a.attname AS col, format_type(a.atttypid, a.atttypmod) AS type
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
      WHERE a.attrelid IN (to_regclass(${LUMP}), to_regclass(${ALLOC})) AND a.attname IN ('amount', 'on_date') AND NOT a.attisdropped
      ORDER BY c.relname, a.attname
    `.execute(owner)
    expect(rows).toEqual([
      { rel: 'lump_sum_allocations', col: 'amount', type: 'numeric(19,4)' },
      { rel: 'lump_sums', col: 'amount', type: 'numeric(19,4)' },
      { rel: 'lump_sums', col: 'on_date', type: 'date' },
    ])
  })

  it('keys every link on (user_id, ...) so another person\'s debt or lump sum cannot be named', async () => {
    expect(await constraintDef(owner, ALLOC, 'fk_lump_sum_allocations_debt')).toBe(
      'FOREIGN KEY (user_id, debt_id) REFERENCES plugin_debt_payoff.debts(user_id, id) ON DELETE CASCADE',
    )
    expect(await constraintDef(owner, ALLOC, 'fk_lump_sum_allocations_lump_sum')).toBe(
      'FOREIGN KEY (user_id, lump_sum_id) REFERENCES plugin_debt_payoff.lump_sums(user_id, id) ON DELETE CASCADE',
    )
    expect(await constraintDef(owner, 'plugin_debt_payoff.debts', 'ux_debts_user_id')).toBe('UNIQUE (user_id, id)')
  })

  it('refuses a zero or negative amount and a note over 200 characters', async () => {
    await rollsBack(async (trx) => {
      const user = await newUser(trx, 'checks')
      await asOwner(trx, async (t) => {
        for (const amount of ['0', '-1']) {
          await sql`SAVEPOINT s`.execute(t)
          await expect(lumpFor(t, user, amount)).rejects.toThrow(/ck_lump_sums_amount/)
          await sql`ROLLBACK TO SAVEPOINT s`.execute(t)
        }
        await sql`SAVEPOINT s`.execute(t)
        await expect(sql`
          INSERT INTO plugin_debt_payoff.lump_sums (user_id, on_date, amount, note)
          VALUES (${user}::uuid, '2027-01-15', 5, ${'x'.repeat(201)})
        `.execute(t)).rejects.toThrow(/value too long/)
        await sql`ROLLBACK TO SAVEPOINT s`.execute(t)

        const lump = await lumpFor(t, user)
        const debt = await debtFor(t, user, 'm037 card')
        await sql`SAVEPOINT s`.execute(t)
        await expect(sql`
          INSERT INTO plugin_debt_payoff.lump_sum_allocations (lump_sum_id, user_id, debt_id, amount)
          VALUES (${lump}::uuid, ${user}::uuid, ${debt}::uuid, 0)
        `.execute(t)).rejects.toThrow(/ck_lump_sum_allocations_amount/)
        await sql`ROLLBACK TO SAVEPOINT s`.execute(t)
      })
    })
  })

  it('allows a debt once per lump sum and refuses an allocation that names another person\'s debt or lump sum', async () => {
    await rollsBack(async (trx) => {
      const alice = await newUser(trx, 'alice')
      const bob = await newUser(trx, 'bob')
      await asOwner(trx, async (t) => {
        const aliceLump = await lumpFor(t, alice)
        const aliceDebt = await debtFor(t, alice, 'm037 alice')
        const bobDebt = await debtFor(t, bob, 'm037 bob')
        const bobLump = await lumpFor(t, bob)
        const insert = (lumpId: string, userId: string, debtId: string) => sql`
          INSERT INTO plugin_debt_payoff.lump_sum_allocations (lump_sum_id, user_id, debt_id, amount)
          VALUES (${lumpId}::uuid, ${userId}::uuid, ${debtId}::uuid, 10)
        `.execute(t)
        await insert(aliceLump, alice, aliceDebt)

        await sql`SAVEPOINT s`.execute(t)
        await expect(insert(aliceLump, alice, aliceDebt)).rejects.toThrow(/pk_lump_sum_allocations/)
        await sql`ROLLBACK TO SAVEPOINT s`.execute(t)

        await sql`SAVEPOINT s`.execute(t)
        await expect(insert(aliceLump, alice, bobDebt)).rejects.toThrow(/fk_lump_sum_allocations_debt/)
        await sql`ROLLBACK TO SAVEPOINT s`.execute(t)

        await sql`SAVEPOINT s`.execute(t)
        await expect(insert(bobLump, alice, aliceDebt)).rejects.toThrow(/fk_lump_sum_allocations_lump_sum/)
        await sql`ROLLBACK TO SAVEPOINT s`.execute(t)
      })
    })
  })

  it('removes the parts when their debt or their lump sum goes, and everything when the person goes', async () => {
    await rollsBack(async (trx) => {
      const user = await newUser(trx, 'cascade')
      await asOwner(trx, async (t) => {
        const lump = await lumpFor(t, user)
        const other = await lumpFor(t, user, '5')
        const d1 = await debtFor(t, user, 'm037 one')
        const d2 = await debtFor(t, user, 'm037 two')
        for (const [l, d] of [[lump, d1], [lump, d2], [other, d1]] as const) {
          await sql`
            INSERT INTO plugin_debt_payoff.lump_sum_allocations (lump_sum_id, user_id, debt_id, amount)
            VALUES (${l}::uuid, ${user}::uuid, ${d}::uuid, 1)
          `.execute(t)
        }
        expect(await countOf(t, ALLOC, user)).toBe(3)

        await sql`DELETE FROM plugin_debt_payoff.debts WHERE id = ${d1}::uuid`.execute(t)
        expect(await countOf(t, ALLOC, user)).toBe(1) // only (lump, d2) is left
        expect(await countOf(t, LUMP, user)).toBe(2) // a lump sum outlives a debt it was aimed at

        await sql`DELETE FROM plugin_debt_payoff.lump_sums WHERE id = ${lump}::uuid`.execute(t)
        expect(await countOf(t, ALLOC, user)).toBe(0)

        await sql`DELETE FROM core.users WHERE id = ${user}::uuid`.execute(t)
        expect(await countOf(t, LUMP, user)).toBe(0)
      })
    })
  })

  it('is a no-op on a second run', async () => {
    await up(owner)
    expect(await exists(owner, LUMP)).toBe(true)
    expect(await exists(owner, ALLOC)).toBe(true)
  })
})

describe('rows saved before the migration', () => {
  it('keep their debts, their settings and their plan through down and up', async () => {
    await rollsBack(async (trx) => {
      await down(trx) // the schema as 036 left it
      expect(await exists(trx, LUMP)).toBe(false)
      expect(await constraintDef(trx, 'plugin_debt_payoff.debts', 'ux_debts_user_id')).toBeUndefined()
      const user = await newUser(trx, 'old')
      const OLD = ['plugin_debt_payoff.debts', 'plugin_debt_payoff.plan_settings']
      await withOwnerBackfillAccess(trx, OLD, async (t) => {
        await sql`INSERT INTO plugin_debt_payoff.plan_settings (user_id, extra_payment, strategy) VALUES (${user}::uuid, 25, 'custom')`.execute(t)
        await debtFor(t, user, 'm037 old a')
        await debtFor(t, user, 'm037 old b')
      })
      const read = () => withOwnerBackfillAccess(trx, OLD, async (t) => (await sql`
        SELECT d.name, d.balance::text AS balance, d.sort_order, s.strategy, s.extra_payment::text AS extra
        FROM plugin_debt_payoff.debts d JOIN plugin_debt_payoff.plan_settings s USING (user_id)
        WHERE d.user_id = ${user}::uuid ORDER BY d.name
      `.execute(t)).rows)
      const first = await read()

      await up(trx)
      expect(await exists(trx, LUMP)).toBe(true)
      expect(await read()).toEqual(first)
      expect(first).toHaveLength(2)
    })
  })
})

describe('down', () => {
  it('drops both tables and the unique constraint, keeps the debts, and up puts them back', async () => {
    await rollsBack(async (trx) => {
      const user = await newUser(trx, 'down')
      await asOwner(trx, async (t) => {
        const debt = await debtFor(t, user, 'm037 keep')
        const lump = await lumpFor(t, user)
        await sql`
          INSERT INTO plugin_debt_payoff.lump_sum_allocations (lump_sum_id, user_id, debt_id, amount)
          VALUES (${lump}::uuid, ${user}::uuid, ${debt}::uuid, 1)
        `.execute(t)
      })

      await down(trx)
      expect(await exists(trx, LUMP)).toBe(false)
      expect(await exists(trx, ALLOC)).toBe(false)
      expect(await constraintDef(trx, 'plugin_debt_payoff.debts', 'ux_debts_user_id')).toBeUndefined()
      const kept = await withOwnerBackfillAccess(trx, ['plugin_debt_payoff.debts'], async (t) => countOf(t, 'plugin_debt_payoff.debts', user))
      expect(kept).toBe(1)

      await down(trx) // a second run has nothing to do
      await up(trx)
      expect(await exists(trx, LUMP)).toBe(true)
      expect(await exists(trx, ALLOC)).toBe(true)
      expect(await constraintDef(trx, 'plugin_debt_payoff.debts', 'ux_debts_user_id')).toBe('UNIQUE (user_id, id)')
    })
    expect(await exists(owner, LUMP)).toBe(true)
  })
})
