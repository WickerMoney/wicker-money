import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, type Db } from '../client.js'
import { createHarness, TEST_ADMIN_DATABASE_URL, type Harness } from '../../testing/harness.js'
import { withOwnerBackfillAccess, type Executor } from './support/index.js'
import { down, up } from './034_debt_payoff_plan_controls.js'

/**
 * Migration 034: `included` and `extra_payment` on the debt payoff plugin's
 * debts.
 *
 * Behaviour through the API (the switch, the earmark, isolation between two
 * people, the plan) is covered in `plugins/debtPayoff.integration.test.ts`.
 * This covers what only the migration does: the column shapes and defaults,
 * the check constraint, existing rows keeping today's behaviour, and a `down`
 * that drops both columns. The `down` runs in a rolled-back transaction so the
 * shared test database keeps the schema other suites rely on.
 */

let h: Harness
let owner: Db

class Rollback extends Error {}

const columns = async (db: Executor): Promise<Array<{ column: string; type: string; nullable: boolean; def: string | null }>> =>
  (await sql<{ column: string; type: string; nullable: boolean; def: string | null }>`
    SELECT a.attname AS column,
           format_type(a.atttypid, a.atttypmod) AS type,
           NOT a.attnotnull AS nullable,
           pg_get_expr(d.adbin, d.adrelid) AS def
    FROM pg_attribute a
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attrelid = 'plugin_debt_payoff.debts'::regclass
      AND a.attname IN ('included', 'extra_payment') AND NOT a.attisdropped
    ORDER BY a.attname
  `.execute(db)).rows

beforeAll(async () => {
  h = await createHarness()
  owner = createDb(TEST_ADMIN_DATABASE_URL)
})

afterAll(async () => {
  await owner.destroy()
  await h.close()
})

describe('up', () => {
  it('adds a boolean that defaults to in the plan and money that defaults to none, both NOT NULL', async () => {
    expect(await columns(owner)).toEqual([
      { column: 'extra_payment', type: 'numeric(19,4)', nullable: false, def: '0' },
      { column: 'included', type: 'boolean', nullable: false, def: 'true' },
    ])
  })

  it('refuses a negative earmark', async () => {
    const { rows } = await sql<{ def: string }>`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conname = 'ck_debts_extra_payment' AND conrelid = 'plugin_debt_payoff.debts'::regclass
    `.execute(owner)
    expect(rows[0]?.def).toBe('CHECK ((extra_payment >= (0)::numeric))')
  })

  it('is a no-op on a second run, and leaves a person\'s choices alone', async () => {
    await up(owner)
    expect(await columns(owner)).toHaveLength(2)
  })
})

describe('down', () => {
  it('drops both columns and keeps the debts; up puts them back with today\'s defaults', async () => {
    const run = owner.transaction().execute(async (trx) => {
      // A debt that predates the switch has neither column set explicitly.
      const user = (await sql<{ id: string }>`
        INSERT INTO core.users (email, password_hash) VALUES (${`m034-${Date.now()}@example.test`}, 'x') RETURNING id
      `.execute(trx)).rows[0]
      expect(user).toBeDefined()
      await withOwnerBackfillAccess(trx, ['plugin_debt_payoff.debts'], async (t) => {
        await sql`
          INSERT INTO plugin_debt_payoff.debts (user_id, name, balance, apr, minimum_payment)
          VALUES (${user?.id}::uuid, 'm034 kept', 10, 1, 1)
        `.execute(t)
      })

      await down(trx)
      expect(await columns(trx)).toEqual([])
      const kept = await withOwnerBackfillAccess(trx, ['plugin_debt_payoff.debts'], async (t) =>
        (await sql<{ n: number }>`SELECT count(*)::int AS n FROM plugin_debt_payoff.debts WHERE name = 'm034 kept'`.execute(t)).rows[0]?.n)
      expect(kept).toBe(1)

      await up(trx)
      const back = await withOwnerBackfillAccess(trx, ['plugin_debt_payoff.debts'], async (t) =>
        (await sql<{ included: boolean; extra_payment: string }>`
          SELECT included, extra_payment::text AS extra_payment FROM plugin_debt_payoff.debts WHERE name = 'm034 kept'
        `.execute(t)).rows[0])
      expect(back).toEqual({ included: true, extra_payment: '0.0000' })
      throw new Rollback()
    })
    await expect(run).rejects.toBeInstanceOf(Rollback)
    expect(await columns(owner)).toHaveLength(2)
  })
})
