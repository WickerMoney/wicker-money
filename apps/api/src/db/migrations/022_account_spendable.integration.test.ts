import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, type Db } from '../client.js'
import { auth, createHarness, createUser, TEST_ADMIN_DATABASE_URL, type Harness, type TestUser } from '../../testing/harness.js'
import { withOwnerBackfillAccess } from './support/index.js'
import { backfillSpendable, up } from './022_account_spendable.js'

/**
 * Migration 022: `core.accounts.spendable`.
 *
 * The parts worth testing live in the database: the CHECK that keeps cards and
 * loans out, a backfill that runs as the owner under FORCE row-level security
 * (lesson #1), and a re-run that must not reset anyone's choice.
 */

let h: Harness
let owner: Db
let alice: TestUser
const ids: Record<'checking' | 'savings' | 'card', string> = { checking: '', savings: '', card: '' }

async function makeAccount(name: string, accountType: string): Promise<string> {
  const res = await h.app.inject({
    method: 'POST', url: '/api/v1/accounts', headers: auth(alice),
    payload: { name, accountType, initialBalance: '0.00' },
  })
  expect(res.statusCode).toBe(201)
  return (res.json() as { id: string }).id
}

async function spendableOf(id: string): Promise<boolean> {
  return asUser(h.db, alice.id, async (trx) =>
    (await trx.selectFrom('core.accounts').select('spendable').where('id', '=', id).executeTakeFirstOrThrow()).spendable)
}

/** Rolls a transaction back after the assertions inside it have run. */
class Rollback extends Error {}

beforeAll(async () => {
  h = await createHarness()
  owner = createDb(TEST_ADMIN_DATABASE_URL)
  alice = await createUser(h)
  ids.checking = await makeAccount('Checking', 'checking')
  ids.savings = await makeAccount('Savings', 'savings')
  ids.card = await makeAccount('Card', 'credit_card')
})

afterAll(async () => {
  await owner.destroy()
  await h.close()
})

describe('backfill', () => {
  it('marks checking accounts spendable, and only those, through FORCE row-level security', async () => {
    const run = owner.transaction().execute(async (trx) => {
      // Put Alice's accounts back in the state the column is added in.
      await withOwnerBackfillAccess(trx, ['core.accounts'], (t) =>
        sql`UPDATE core.accounts SET spendable = false WHERE user_id = ${alice.id}`.execute(t))

      expect(await backfillSpendable(trx)).toBeGreaterThanOrEqual(1)

      const rows = await withOwnerBackfillAccess(trx, ['core.accounts'], async (t) =>
        (await sql<{ id: string; spendable: boolean }>`
          SELECT id, spendable FROM core.accounts WHERE user_id = ${alice.id}
        `.execute(t)).rows)
      const by = Object.fromEntries(rows.map((r) => [r.id, r.spendable]))
      expect(by).toEqual({ [ids.checking]: true, [ids.savings]: false, [ids.card]: false })
      throw new Rollback()
    })
    await expect(run).rejects.toBeInstanceOf(Rollback)
  })

  it('leaves no backfill policy behind', async () => {
    const { rows } = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM pg_policies
      WHERE schemaname = 'core' AND tablename = 'accounts' AND policyname = 'migration_backfill'
    `.execute(owner)
    expect(rows[0]?.n).toBe(0)
  })
})

describe('re-running', () => {
  it('never resets a choice the user already made', async () => {
    const res = await h.app.inject({
      method: 'PATCH', url: `/api/v1/accounts/${ids.checking}`, headers: auth(alice), payload: { spendable: false },
    })
    expect(res.statusCode).toBe(200)

    await up(owner)

    expect(await spendableOf(ids.checking)).toBe(false)
  })
})

describe('the CHECK', () => {
  it('refuses a spendable card even when the API is bypassed', async () => {
    const error = await asUser(h.db, alice.id, (trx) =>
      trx.updateTable('core.accounts').set({ spendable: true }).where('id', '=', ids.card).execute(),
    ).then(() => undefined, (e: unknown) => e)
    expect((error as { constraint?: string } | undefined)?.constraint).toBe('ck_accounts_spendable_type')
  })

  it('allows a spendable savings account', async () => {
    await asUser(h.db, alice.id, (trx) =>
      trx.updateTable('core.accounts').set({ spendable: true }).where('id', '=', ids.savings).execute())
    expect(await spendableOf(ids.savings)).toBe(true)
  })
})
