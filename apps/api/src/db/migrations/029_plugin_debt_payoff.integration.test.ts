import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, type Db } from '../client.js'
import { createHarness, TEST_ADMIN_DATABASE_URL, type Harness } from '../../testing/harness.js'
import type { Executor } from './support/index.js'
import { down, up } from './029_plugin_debt_payoff.js'

/**
 * Migration 029: the debt payoff plugin's own schema.
 *
 * Behaviour through the API (CRUD, isolation between two people, the account
 * link rules) is covered in `plugins/debtPayoff.integration.test.ts`; the
 * row-level-security invariants and the re-run snapshot are swept for every
 * table elsewhere. This covers what only the migration does: the shape, the
 * CHECK constraints, and a `down` that runs in a rolled-back transaction so
 * the shared test database keeps the schema other suites rely on.
 */

let h: Harness
let owner: Db

class Rollback extends Error {}

const TABLES = ['plugin_debt_payoff.debts', 'plugin_debt_payoff.plan_settings']

const schemaExists = async (db: Executor): Promise<boolean> =>
  (await sql<{ found: boolean }>`SELECT to_regnamespace('plugin_debt_payoff') IS NOT NULL AS found`.execute(db))
    .rows[0]?.found === true

beforeAll(async () => {
  h = await createHarness()
  owner = createDb(TEST_ADMIN_DATABASE_URL)
})

afterAll(async () => {
  await owner.destroy()
  await h.close()
})

describe('up', () => {
  it('creates both tables under forced row-level security', async () => {
    for (const table of TABLES) {
      const { rows } = await sql<{ enabled: boolean; forced: boolean }>`
        SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced
        FROM pg_class WHERE oid = to_regclass(${table})
      `.execute(owner)
      expect(rows[0], table).toEqual({ enabled: true, forced: true })
    }
  })

  it('stores money as numeric(19,4)', async () => {
    const { rows } = await sql<{ col: string; type: string }>`
      SELECT a.attname AS col, format_type(a.atttypid, a.atttypmod) AS type
      FROM pg_attribute a
      WHERE a.attrelid IN (to_regclass('plugin_debt_payoff.debts'), to_regclass('plugin_debt_payoff.plan_settings'))
        AND a.attname IN ('balance', 'minimum_payment', 'extra_payment')
      ORDER BY a.attname
    `.execute(owner)
    expect(rows).toEqual([
      { col: 'balance', type: 'numeric(19,4)' },
      { col: 'extra_payment', type: 'numeric(19,4)' },
      { col: 'minimum_payment', type: 'numeric(19,4)' },
    ])
  })

  it('keys the account link on (user_id, account_id) so another user’s account cannot be named', async () => {
    const { rows } = await sql<{ def: string }>`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conname = 'fk_debts_account_owned' AND conrelid = 'plugin_debt_payoff.debts'::regclass
    `.execute(owner)
    expect(rows[0]?.def).toContain('FOREIGN KEY (user_id, account_id) REFERENCES core.accounts(user_id, id)')
    expect(rows[0]?.def).toContain('ON DELETE SET NULL (account_id)')
  })

  it('is a no-op on a second run', async () => {
    await up(owner)
    expect(await schemaExists(owner)).toBe(true)
  })
})

describe('down', () => {
  it('drops the schema, and up puts it back', async () => {
    const run = owner.transaction().execute(async (trx) => {
      await down(trx)
      expect(await schemaExists(trx)).toBe(false)
      await up(trx)
      expect(await schemaExists(trx)).toBe(true)
      await down(trx)
      throw new Rollback()
    })
    await expect(run).rejects.toBeInstanceOf(Rollback)
    expect(await schemaExists(owner)).toBe(true)
  })
})
