import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, type Db } from '../client.js'
import { auth, createHarness, createUser, TEST_ADMIN_DATABASE_URL, type Harness, type TestUser } from '../../testing/harness.js'
import { up } from './024_recurring_occurrences.js'

/**
 * Migration 024: recurring occurrences, their per-leg amounts, and the link
 * from a transaction to the occurrence it settles.
 *
 * What is worth testing lives in the database: the composite keys that keep
 * one user's transaction from settling another user's occurrence (lesson #8),
 * the CHECKs, and what each delete does to the rows that point at it. The
 * row-level security invariants and the re-run snapshot are covered for every
 * table by the suites that already sweep them.
 */

let h: Harness
let owner: Db
let alice: TestUser
let bob: TestUser

/** Creates an account through the API. */
async function makeAccount(user: TestUser, name: string, accountType = 'checking'): Promise<string> {
  const res = await h.app.inject({
    method: 'POST', url: '/api/v1/accounts', headers: auth(user), payload: { name, accountType, initialBalance: '0.00' },
  })
  expect(res.statusCode).toBe(201)
  return (res.json() as { id: string }).id
}

/** Inserts an item with the given legs, an occurrence of it, and returns both ids. */
async function itemWithOccurrence(
  user: TestUser,
  kind: 'income' | 'bill',
  legs: ReadonlyArray<readonly [accountId: string, amount: string]>,
): Promise<{ itemId: string; occurrenceId: string }> {
  return asUser(h.db, user.id, async (trx) => {
    const item = await trx.insertInto('core.recurring_items')
      .values({ user_id: user.id, name: kind, kind, frequency: 'monthly', series_start_date: '2026-01-01' })
      .returning('id').executeTakeFirstOrThrow()
    await trx.insertInto('core.recurring_item_legs')
      .values(legs.map(([accountId, amount]) => ({ user_id: user.id, recurring_item_id: item.id, account_id: accountId, amount })))
      .execute()
    const occurrence = await trx.insertInto('core.recurring_occurrences')
      .values({ user_id: user.id, recurring_item_id: item.id, nominal_date: '2026-10-01' })
      .returning('id').executeTakeFirstOrThrow()
    return { itemId: item.id, occurrenceId: occurrence.id }
  })
}

/** Inserts a transaction, optionally linked to an occurrence. */
async function transaction(user: TestUser, accountId: string, amount: string, occurrenceId: string | null = null): Promise<string> {
  return asUser(h.db, user.id, async (trx) => (await trx.insertInto('core.transactions')
    .values({
      user_id: user.id, account_id: accountId, amount, merchant: 'Test', transaction_date: '2026-10-01',
      recurring_occurrence_id: occurrenceId,
    })
    .returning('id').executeTakeFirstOrThrow()).id)
}

/** The error a write fails with, or `undefined` if it succeeds. */
async function failure(work: Promise<unknown>): Promise<{ code?: string; constraint?: string } | undefined> {
  return work.then(() => undefined, (e: unknown) => e as { code?: string; constraint?: string })
}

beforeAll(async () => {
  h = await createHarness()
  owner = createDb(TEST_ADMIN_DATABASE_URL)
  alice = await createUser(h)
  bob = await createUser(h)
})

afterAll(async () => {
  await owner.destroy()
  await h.close()
})

describe('composite keys', () => {
  it("refuses a transaction settling another user's occurrence, even with the API bypassed", async () => {
    const bobAccount = await makeAccount(bob, 'Bob checking')
    const { occurrenceId } = await itemWithOccurrence(bob, 'bill', [[bobAccount, '-10.0000']])
    const aliceAccount = await makeAccount(alice, 'Alice checking')

    const error = await failure(transaction(alice, aliceAccount, '-10.00', occurrenceId))
    expect(error?.constraint).toBe('fk_transactions_recurring_occurrence_id_owned')
  })

  it("refuses an occurrence amount on another user's account", async () => {
    const bobAccount = await makeAccount(bob, 'Bob other')
    const aliceAccount = await makeAccount(alice, 'Alice bills')
    const { occurrenceId } = await itemWithOccurrence(alice, 'bill', [[aliceAccount, '-10.0000']])

    const error = await failure(asUser(h.db, alice.id, (trx) => trx.insertInto('core.recurring_occurrence_legs')
      .values({ user_id: alice.id, recurring_occurrence_id: occurrenceId, account_id: bobAccount, amount: '-5.00' })
      .execute()))
    expect(error?.constraint).toBe('fk_recurring_occurrence_legs_account_id_owned')
  })
})

describe('checks', () => {
  it('refuses an occurrence that is both skipped and moved', async () => {
    const account = await makeAccount(alice, 'Check skip')
    const { itemId } = await itemWithOccurrence(alice, 'bill', [[account, '-10.0000']])
    const error = await failure(asUser(h.db, alice.id, (trx) => trx.insertInto('core.recurring_occurrences')
      .values({ user_id: alice.id, recurring_item_id: itemId, nominal_date: '2026-11-01', skipped: true, expected_date: '2026-11-03' })
      .execute()))
    expect(error?.constraint).toBe('ck_recurring_occurrences_skipped_not_moved')
  })

  it('refuses a second row for the same occurrence', async () => {
    const account = await makeAccount(alice, 'Check twice')
    const { itemId } = await itemWithOccurrence(alice, 'bill', [[account, '-10.0000']])
    const error = await failure(asUser(h.db, alice.id, (trx) => trx.insertInto('core.recurring_occurrences')
      .values({ user_id: alice.id, recurring_item_id: itemId, nominal_date: '2026-10-01' })
      .execute()))
    expect(error?.constraint).toBe('uq_recurring_occurrences_item_nominal')
  })

  it('refuses a zero occurrence amount', async () => {
    const account = await makeAccount(alice, 'Check zero')
    const { occurrenceId } = await itemWithOccurrence(alice, 'bill', [[account, '-10.0000']])
    const error = await failure(asUser(h.db, alice.id, (trx) => trx.insertInto('core.recurring_occurrence_legs')
      .values({ user_id: alice.id, recurring_occurrence_id: occurrenceId, account_id: account, amount: '0' })
      .execute()))
    expect(error?.constraint).toBe('ck_recurring_occurrence_legs_amount_nonzero')
  })
})

describe('deletes', () => {
  it('keeps a settling transaction when its item is deleted, and only unlinks it', async () => {
    const account = await makeAccount(alice, 'Delete item')
    const { itemId, occurrenceId } = await itemWithOccurrence(alice, 'bill', [[account, '-10.0000']])
    const txId = await transaction(alice, account, '-10.00', occurrenceId)

    const res = await h.app.inject({ method: 'DELETE', url: `/api/v1/recurring-items/${itemId}`, headers: auth(alice) })
    expect(res.statusCode).toBe(204)

    const row = await asUser(h.db, alice.id, (trx) => trx.selectFrom('core.transactions')
      .select(['user_id', 'recurring_occurrence_id']).where('id', '=', txId).executeTakeFirst())
    expect(row).toEqual({ user_id: alice.id, recurring_occurrence_id: null })
    const left = await asUser(h.db, alice.id, (trx) => trx.selectFrom('core.recurring_occurrences')
      .select('id').where('id', '=', occurrenceId).execute())
    expect(left).toEqual([])
  })

  it('removes the occurrence amounts on an account deleted with its history', async () => {
    const account = await makeAccount(alice, 'Delete account')
    const { occurrenceId } = await itemWithOccurrence(alice, 'bill', [[account, '-10.0000']])
    await asUser(h.db, alice.id, (trx) => trx.insertInto('core.recurring_occurrence_legs')
      .values({ user_id: alice.id, recurring_occurrence_id: occurrenceId, account_id: account, amount: '-12.00' })
      .execute())

    const usage = await h.app.inject({ method: 'GET', url: `/api/v1/accounts/${account}/usage`, headers: auth(alice) })
    const confirmCount = (usage.json() as { total: number }).total
    const res = await h.app.inject({
      method: 'POST', url: `/api/v1/accounts/${account}/delete-with-history`, headers: auth(alice), payload: { confirmCount },
    })
    expect(res.statusCode).toBe(200)

    const left = await asUser(h.db, alice.id, (trx) => trx.selectFrom('core.recurring_occurrence_legs')
      .select('id').where('recurring_occurrence_id', '=', occurrenceId).execute())
    expect(left).toEqual([])
  })
})

describe('account merge', () => {
  it('moves an occurrence amount with its leg, and drops it when a split paycheck folds into one leg', async () => {
    const from = await makeAccount(alice, 'Merge from')
    const to = await makeAccount(alice, 'Merge to')
    const bill = await itemWithOccurrence(alice, 'bill', [[from, '-10.0000']])
    const pay = await itemWithOccurrence(alice, 'income', [[from, '100.0000'], [to, '50.0000']])
    await asUser(h.db, alice.id, (trx) => trx.insertInto('core.recurring_occurrence_legs')
      .values([
        { user_id: alice.id, recurring_occurrence_id: bill.occurrenceId, account_id: from, amount: '-12.00' },
        { user_id: alice.id, recurring_occurrence_id: pay.occurrenceId, account_id: from, amount: '110.00' },
      ])
      .execute())

    const preview = await h.app.inject({
      method: 'POST', url: `/api/v1/accounts/${from}/migrate/preview`, headers: auth(alice), payload: { toAccountId: to },
    })
    const confirmCount = (preview.json() as { totalAffected: number }).totalAffected
    const res = await h.app.inject({
      method: 'POST', url: `/api/v1/accounts/${from}/migrate`, headers: auth(alice), payload: { toAccountId: to, confirmCount },
    })
    expect(res.statusCode).toBe(200)

    const rows = await asUser(h.db, alice.id, (trx) => trx.selectFrom('core.recurring_occurrence_legs')
      .select(['recurring_occurrence_id', 'account_id', 'amount'])
      .where('recurring_occurrence_id', 'in', [bill.occurrenceId, pay.occurrenceId])
      .execute())
    expect(rows).toEqual([{ recurring_occurrence_id: bill.occurrenceId, account_id: to, amount: '-12.0000' }])
  })
})

describe('re-running', () => {
  it('changes nothing on a migrated database', async () => {
    const before = await sql<{ n: number }>`SELECT count(*)::int AS n FROM pg_constraint WHERE conname LIKE '%recurring_occurrence%'`.execute(owner)
    await up(owner)
    const after = await sql<{ n: number }>`SELECT count(*)::int AS n FROM pg_constraint WHERE conname LIKE '%recurring_occurrence%'`.execute(owner)
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n)
  })
})
