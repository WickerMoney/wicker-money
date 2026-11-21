import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, type Db } from '../client.js'
import { createHarness, TEST_ADMIN_DATABASE_URL, type Harness } from '../../testing/harness.js'
import { withOwnerBackfillAccess, type Executor } from './support/index.js'
import { down, up } from './036_debt_payoff_custom_order.js'

/**
 * Migration 036: the debt payoff plugin may save the strategy `custom`.
 *
 * Behaviour through the API (saving it, the reorder route, isolation between
 * two people, the plan) is covered in `plugins/debtPayoff.integration.test.ts`.
 * This covers what only the migration does: the check's new definition, that
 * `debts.sort_order` is already there with the shape the feature relies on (the
 * migration adds no column), that rows saved before it keep their strategy and
 * their order, and a `down` that moves a Custom order person to the default and
 * keeps everything else. `down` runs in a rolled-back transaction so the shared
 * test database keeps the schema other suites rely on.
 */

let h: Harness
let owner: Db

class Rollback extends Error {}

const checkDefinition = async (db: Executor): Promise<string | undefined> =>
  (await sql<{ def: string }>`
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conname = 'ck_plan_settings_strategy' AND conrelid = 'plugin_debt_payoff.plan_settings'::regclass
  `.execute(db)).rows[0]?.def

const TABLES = ['plugin_debt_payoff.debts', 'plugin_debt_payoff.plan_settings'] as const

/** Inserts a user, with debts at the given positions and a strategy. */
async function seed(trx: Executor, tag: string, strategy: string, positions: readonly number[]): Promise<string> {
  const user = (await sql<{ id: string }>`
    INSERT INTO core.users (email, password_hash) VALUES (${`m036-${tag}-${Math.random()}@example.test`}, 'x') RETURNING id
  `.execute(trx)).rows[0]
  if (user === undefined) throw new Error('no user')
  await withOwnerBackfillAccess(trx, TABLES, async (t) => {
    await sql`INSERT INTO plugin_debt_payoff.plan_settings (user_id, extra_payment, strategy) VALUES (${user.id}::uuid, 25, ${strategy})`.execute(t)
    for (const [i, position] of positions.entries()) {
      await sql`
        INSERT INTO plugin_debt_payoff.debts (user_id, name, balance, apr, minimum_payment, sort_order)
        VALUES (${user.id}::uuid, ${`m036 ${tag} ${i}`}, 10, 1, 1, ${position})
      `.execute(t)
    }
  })
  return user.id
}

const settingsOf = (trx: Executor, userId: string) =>
  withOwnerBackfillAccess(trx, TABLES, async (t) =>
    (await sql<{ strategy: string; extra: string }>`
      SELECT strategy, extra_payment::text AS extra FROM plugin_debt_payoff.plan_settings WHERE user_id = ${userId}::uuid
    `.execute(t)).rows[0])

const orderOf = (trx: Executor, userId: string) =>
  withOwnerBackfillAccess(trx, TABLES, async (t) =>
    (await sql<{ name: string; sort_order: number }>`
      SELECT name, sort_order FROM plugin_debt_payoff.debts WHERE user_id = ${userId}::uuid ORDER BY sort_order, created_at, id
    `.execute(t)).rows)

beforeAll(async () => {
  h = await createHarness()
  owner = createDb(TEST_ADMIN_DATABASE_URL)
})

afterAll(async () => {
  await owner.destroy()
  await h.close()
})

describe('up', () => {
  it('allows the three strategies and no others', async () => {
    expect(await checkDefinition(owner)).toBe(
      "CHECK (((strategy)::text = ANY ((ARRAY['snowball'::character varying, 'avalanche'::character varying, 'custom'::character varying])::text[])))",
    )
  })

  it('adds no column: sort_order is the integer NOT NULL column from migration 030, with no unique constraint', async () => {
    const { rows } = await sql<{ type: string; nullable: boolean; def: string | null }>`
      SELECT format_type(a.atttypid, a.atttypmod) AS type, NOT a.attnotnull AS nullable, pg_get_expr(d.adbin, d.adrelid) AS def
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = 'plugin_debt_payoff.debts'::regclass AND a.attname = 'sort_order' AND NOT a.attisdropped
    `.execute(owner)
    expect(rows).toEqual([{ type: 'integer', nullable: false, def: '0' }])
    const unique = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
      WHERE i.indrelid = 'plugin_debt_payoff.debts'::regclass AND i.indisunique AND a.attname = 'sort_order'
    `.execute(owner)
    expect(unique.rows[0]?.n).toBe(0)
  })

  it('accepts custom and refuses an unknown strategy', async () => {
    const run = owner.transaction().execute(async (trx) => {
      await seed(trx, 'accept', 'custom', [])
      await sql`SAVEPOINT refused`.execute(trx)
      await expect(seed(trx, 'reject', 'random', [])).rejects.toThrow(/ck_plan_settings_strategy/)
      await sql`ROLLBACK TO SAVEPOINT refused`.execute(trx)
      throw new Rollback()
    })
    await expect(run).rejects.toBeInstanceOf(Rollback)
  })

  it('is a no-op on a second run', async () => {
    const before = await checkDefinition(owner)
    await up(owner)
    expect(await checkDefinition(owner)).toBe(before)
  })
})

describe('rows saved before the migration', () => {
  it('keep their strategy, their extra and their order through down and up', async () => {
    const run = owner.transaction().execute(async (trx) => {
      await down(trx) // the schema as 035 left it
      expect(await checkDefinition(trx)).toContain("'avalanche'")
      expect(await checkDefinition(trx)).not.toContain("'custom'")
      const old = await seed(trx, 'old', 'snowball', [3, 1, 2])
      const before = await orderOf(trx, old)

      await up(trx)
      expect(await settingsOf(trx, old)).toEqual({ strategy: 'snowball', extra: '25.0000' })
      expect(await orderOf(trx, old)).toEqual(before)
      expect(before.map((r) => r.sort_order)).toEqual([1, 2, 3])
      throw new Rollback()
    })
    await expect(run).rejects.toBeInstanceOf(Rollback)
  })
})

describe('down', () => {
  it('moves a person on Custom order to avalanche, keeps everyone else and every debt, and up restores the check', async () => {
    const run = owner.transaction().execute(async (trx) => {
      const custom = await seed(trx, 'custom', 'custom', [2, 0, 1])
      const snow = await seed(trx, 'snow', 'snowball', [0])
      const orderBefore = await orderOf(trx, custom)

      await down(trx)
      expect(await checkDefinition(trx)).not.toContain("'custom'")
      expect(await settingsOf(trx, custom)).toEqual({ strategy: 'avalanche', extra: '25.0000' })
      expect(await settingsOf(trx, snow)).toEqual({ strategy: 'snowball', extra: '25.0000' })
      expect(await orderOf(trx, custom)).toEqual(orderBefore)

      await up(trx)
      expect(await checkDefinition(trx)).toContain("'custom'")
      throw new Rollback()
    })
    await expect(run).rejects.toBeInstanceOf(Rollback)
    expect(await checkDefinition(owner)).toContain("'custom'")
  })
})
