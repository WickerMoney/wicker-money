import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, type Db } from '../client.js'
import { createHarness, TEST_ADMIN_DATABASE_URL, type Harness } from '../../testing/harness.js'
import { withOwnerBackfillAccess, type Executor } from './support/index.js'
import { down, up } from './035_debt_payoff_timelines.js'

/**
 * Migration 035: repayment start, promotion and compounding columns on the
 * debt payoff plugin's debts.
 *
 * Behaviour through the API (saving, reading, isolation between two people, the
 * plan) is covered in `plugins/debtPayoff.integration.test.ts`. This covers
 * what only the migration does: the column shapes and defaults, the checks,
 * existing rows keeping today's behaviour, and a `down` that drops all six
 * columns. The `down` runs in a rolled-back transaction so the shared test
 * database keeps the schema other suites rely on.
 */

let h: Harness
let owner: Db

class Rollback extends Error {}

const NAMES = ['compounding', 'promo_apr', 'promo_deferred_interest', 'promo_ends_on', 'promo_interest_base', 'repayment_starts_on']

const columns = async (db: Executor): Promise<Array<{ column: string; type: string; nullable: boolean; def: string | null }>> =>
  (await sql<{ column: string; type: string; nullable: boolean; def: string | null }>`
    SELECT a.attname AS column,
           format_type(a.atttypid, a.atttypmod) AS type,
           NOT a.attnotnull AS nullable,
           pg_get_expr(d.adbin, d.adrelid) AS def
    FROM pg_attribute a
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attrelid = 'plugin_debt_payoff.debts'::regclass
      AND a.attname = ANY(${NAMES}::text[]) AND NOT a.attisdropped
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
  it('adds nullable dates and rate, and NOT NULL flags with today\'s behaviour as the default', async () => {
    expect(await columns(owner)).toEqual([
      { column: 'compounding', type: 'text', nullable: false, def: "'monthly'::text" },
      { column: 'promo_apr', type: 'numeric(7,4)', nullable: true, def: null },
      { column: 'promo_deferred_interest', type: 'boolean', nullable: false, def: 'false' },
      { column: 'promo_ends_on', type: 'date', nullable: true, def: null },
      { column: 'promo_interest_base', type: 'text', nullable: false, def: "'original'::text" },
      { column: 'repayment_starts_on', type: 'date', nullable: true, def: null },
    ])
  })

  it('has the five checks', async () => {
    const { rows } = await sql<{ name: string }>`
      SELECT conname AS name FROM pg_constraint
      WHERE conrelid = 'plugin_debt_payoff.debts'::regclass AND conname LIKE 'ck_debts_%'
        AND conname IN ('ck_debts_promo_apr', 'ck_debts_promo_pair', 'ck_debts_promo_deferred', 'ck_debts_promo_base', 'ck_debts_compounding')
      ORDER BY conname
    `.execute(owner)
    expect(rows.map((r) => r.name)).toEqual([
      'ck_debts_compounding', 'ck_debts_promo_apr', 'ck_debts_promo_base', 'ck_debts_promo_deferred', 'ck_debts_promo_pair',
    ])
  })

  it('refuses a half promotion, deferred interest without one, and unknown options', async () => {
    const bad = (cols: string, vals: string) => owner.transaction().execute(async (trx) => {
      const user = (await sql<{ id: string }>`
        INSERT INTO core.users (email, password_hash) VALUES (${`m035-${Math.random()}@example.test`}, 'x') RETURNING id
      `.execute(trx)).rows[0]
      await withOwnerBackfillAccess(trx, ['plugin_debt_payoff.debts'], async (t) => {
        await sql.raw(
          `INSERT INTO plugin_debt_payoff.debts (user_id, name, balance, apr, minimum_payment, ${cols}) ` +
          `VALUES ('${user?.id}'::uuid, 'x', 10, 1, 1, ${vals})`,
        ).execute(t)
      })
    })
    await expect(bad('promo_apr', '0')).rejects.toThrow(/ck_debts_promo_pair/)
    await expect(bad('promo_ends_on', "'2027-01-01'")).rejects.toThrow(/ck_debts_promo_pair/)
    await expect(bad('promo_deferred_interest', 'true')).rejects.toThrow(/ck_debts_promo_deferred/)
    await expect(bad('promo_apr, promo_ends_on', "-1, '2027-01-01'")).rejects.toThrow(/ck_debts_promo_apr/)
    await expect(bad('compounding', "'weekly'")).rejects.toThrow(/ck_debts_compounding/)
    await expect(bad('promo_interest_base', "'x'")).rejects.toThrow(/ck_debts_promo_base/)
  })

  it('is a no-op on a second run', async () => {
    await up(owner)
    expect(await columns(owner)).toHaveLength(6)
  })
})

describe('down', () => {
  it('drops all six columns and keeps the debts; up puts them back with today\'s defaults', async () => {
    const run = owner.transaction().execute(async (trx) => {
      const user = (await sql<{ id: string }>`
        INSERT INTO core.users (email, password_hash) VALUES (${`m035-${Date.now()}@example.test`}, 'x') RETURNING id
      `.execute(trx)).rows[0]
      await withOwnerBackfillAccess(trx, ['plugin_debt_payoff.debts'], async (t) => {
        await sql`
          INSERT INTO plugin_debt_payoff.debts (user_id, name, balance, apr, minimum_payment)
          VALUES (${user?.id}::uuid, 'm035 kept', 10, 1, 1)
        `.execute(t)
      })

      await down(trx)
      expect(await columns(trx)).toEqual([])
      const kept = await withOwnerBackfillAccess(trx, ['plugin_debt_payoff.debts'], async (t) =>
        (await sql<{ n: number }>`SELECT count(*)::int AS n FROM plugin_debt_payoff.debts WHERE name = 'm035 kept'`.execute(t)).rows[0]?.n)
      expect(kept).toBe(1)

      await up(trx)
      const back = await withOwnerBackfillAccess(trx, ['plugin_debt_payoff.debts'], async (t) =>
        (await sql<Record<string, unknown>>`
          SELECT repayment_starts_on, promo_apr, promo_ends_on, promo_deferred_interest, promo_interest_base, compounding
          FROM plugin_debt_payoff.debts WHERE name = 'm035 kept'
        `.execute(t)).rows[0])
      expect(back).toEqual({
        repayment_starts_on: null, promo_apr: null, promo_ends_on: null,
        promo_deferred_interest: false, promo_interest_base: 'original', compounding: 'monthly',
      })
      throw new Rollback()
    })
    await expect(run).rejects.toBeInstanceOf(Rollback)
    expect(await columns(owner)).toHaveLength(6)
  })
})
