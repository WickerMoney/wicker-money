import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, type Db } from '../client.js'
import { createHarness, TEST_ADMIN_DATABASE_URL, TEST_APP_ROLE, type Harness } from '../../testing/harness.js'
import type { Executor } from './support/index.js'
import { down, up } from './025_recurring_match_dismissals.js'

/**
 * Migration 025: dismissed match suggestions.
 *
 * Behaviour (cascades, isolation through the API, the composite key refusing
 * another user's transaction) is covered in `recurring/dismissals.integration.test.ts`;
 * the row-level-security invariants and the re-run snapshot are swept for
 * every table elsewhere. This covers what only the migration itself does.
 * The `down` runs in a transaction that is rolled back, so the shared test
 * database keeps the table every other suite relies on.
 */

let h: Harness
let owner: Db

/** Rolls a transaction back after the assertions inside it have run. */
class Rollback extends Error {}

const tableExists = async (db: Executor): Promise<boolean> =>
  (await sql<{ found: boolean }>`SELECT to_regclass('core.recurring_match_dismissals') IS NOT NULL AS found`.execute(db))
    .rows[0]?.found === true

const ledgerKeyExists = async (db: Executor): Promise<boolean> =>
  (await sql<{ n: number }>`
    SELECT count(*)::int AS n FROM pg_constraint
    WHERE conrelid = 'core.transactions'::regclass AND conname = 'uq_transactions_user_id_id'
  `.execute(db)).rows[0]?.n === 1

beforeAll(async () => {
  h = await createHarness()
  owner = createDb(TEST_ADMIN_DATABASE_URL)
})

afterAll(async () => {
  await owner.destroy()
  await h.close()
})

describe('up', () => {
  it('adds the table under forced row-level security, with DML for the app role', async () => {
    expect(await tableExists(owner)).toBe(true)
    expect(await ledgerKeyExists(owner)).toBe(true)
    const { rows } = await sql<{ enabled: boolean; forced: boolean; dml: boolean }>`
      SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced,
             has_table_privilege(${TEST_APP_ROLE}, 'core.recurring_match_dismissals', 'SELECT, INSERT, UPDATE, DELETE') AS dml
      FROM pg_class WHERE oid = 'core.recurring_match_dismissals'::regclass
    `.execute(owner)
    expect(rows[0]).toEqual({ enabled: true, forced: true, dml: true })
  })

  it('is a no-op on a second run', async () => {
    await up(owner)
    expect(await tableExists(owner)).toBe(true)
    expect(await ledgerKeyExists(owner)).toBe(true)
  })
})

describe('down', () => {
  it('drops the table and the ledger key, and up puts them back', async () => {
    const run = owner.transaction().execute(async (trx) => {
      await down(trx)
      expect(await tableExists(trx)).toBe(false)
      expect(await ledgerKeyExists(trx)).toBe(false)
      await up(trx)
      expect(await tableExists(trx)).toBe(true)
      expect(await ledgerKeyExists(trx)).toBe(true)
      await down(trx)
      throw new Rollback()
    })
    await expect(run).rejects.toBeInstanceOf(Rollback)
    expect(await tableExists(owner)).toBe(true)
    expect(await ledgerKeyExists(owner)).toBe(true)
  })
})
