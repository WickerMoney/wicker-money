import { sql, type Kysely, type Transaction } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, type Db } from '../client.js'
import type { Database, RecurrenceFrequency, RecurringKind } from '../models/index.js'
import { auth, createHarness, createUser, TEST_ADMIN_DATABASE_URL, type Harness, type TestUser } from '../../testing/harness.js'
import { withOwnerBackfillAccess, type Executor } from './support/index.js'
import { backfillRecurringItemLegs, SEMIMONTHLY_DAYS_CHECK } from './021_recurring_item_legs.js'

/**
 * Migration 021: recurring items as an item plus legs.
 *
 * Everything here runs against real PostgreSQL, because everything worth
 * testing is in the database: the deferred trigger that checks leg shape per
 * kind, the composite keys, row-level security on the new table, and a
 * backfill that runs as the owner under FORCE row-level security (lesson #1).
 */

let h: Harness
let owner: Db
let alice: TestUser
let bob: TestUser
const accounts: Record<'checking' | 'savings' | 'card' | 'bobChecking', string> = {
  checking: '', savings: '', card: '', bobChecking: '',
}

/** The name the trigger reports violations under. */
const LEGS_RULE = 'ck_recurring_items_legs_match_kind'

async function makeAccount(as: TestUser, name: string, accountType: string): Promise<string> {
  const res = await h.app.inject({
    method: 'POST', url: '/api/v1/accounts', headers: auth(as),
    payload: { name, accountType, initialBalance: '0.00' },
  })
  expect(res.statusCode).toBe(201)
  return (res.json() as { id: string }).id
}

interface ItemSpec {
  readonly kind: RecurringKind
  readonly frequency?: RecurrenceFrequency
  readonly semimonthly?: readonly [number | null, number | null]
  readonly legs: readonly (readonly [accountId: string, amount: string])[]
}

/** Inserts an item and its legs in the given transaction; returns the item id. */
async function insertItem(trx: Transaction<Database>, userId: string, spec: ItemSpec): Promise<string> {
  const item = await trx
    .insertInto('core.recurring_items')
    .values({
      user_id: userId,
      name: `Item ${spec.kind}`,
      kind: spec.kind,
      frequency: spec.frequency ?? 'monthly',
      series_start_date: '2026-01-01',
      semimonthly_day_1: spec.semimonthly?.[0] ?? null,
      semimonthly_day_2: spec.semimonthly?.[1] ?? null,
    })
    .returning('id')
    .executeTakeFirstOrThrow()
  if (spec.legs.length > 0) {
    await trx
      .insertInto('core.recurring_item_legs')
      .values(spec.legs.map(([accountId, amount]) => ({
        user_id: userId, recurring_item_id: item.id, account_id: accountId, amount,
      })))
      .execute()
  }
  return item.id
}

/** Inserts an item as Alice in its own transaction, so the deferred trigger runs at commit. */
function create(spec: ItemSpec): Promise<string> {
  return asUser(h.db, alice.id, (trx) => insertItem(trx, alice.id, spec))
}

/** Asserts a promise rejects with a database error naming `constraint`. */
async function rejectsWith(promise: Promise<unknown>, constraint: string): Promise<void> {
  const error = await promise.then(() => undefined, (e: unknown) => e)
  expect(error, `expected a violation of ${constraint}`).toBeDefined()
  expect((error as { constraint?: string }).constraint).toBe(constraint)
}

beforeAll(async () => {
  h = await createHarness()
  owner = createDb(TEST_ADMIN_DATABASE_URL)
  alice = await createUser(h)
  bob = await createUser(h)
  accounts.checking = await makeAccount(alice, 'Checking', 'checking')
  accounts.savings = await makeAccount(alice, 'Savings', 'savings')
  accounts.card = await makeAccount(alice, 'Card', 'credit_card')
  accounts.bobChecking = await makeAccount(bob, 'Bob Checking', 'checking')
})

afterAll(async () => {
  await owner.destroy()
  await h.close()
})

describe('leg shape per kind', () => {
  it.each<[string, () => ItemSpec]>([
    ['a bill: one negative leg', () => ({ kind: 'bill', legs: [[accounts.checking, '-95.00']] })],
    ['income into one account', () => ({ kind: 'income', legs: [[accounts.checking, '2850.00']] })],
    ['a split paycheck: two positive legs', () => ({ kind: 'income', legs: [[accounts.checking, '1850.00'], [accounts.savings, '350.00']] })],
    ['a transfer netting to zero', () => ({ kind: 'transfer', legs: [[accounts.checking, '-200.00'], [accounts.savings, '200.00']] })],
    ['a debt payment netting to zero', () => ({ kind: 'debt_payment', legs: [[accounts.checking, '-400.00'], [accounts.card, '400.00']] })],
    ['a bill charged to a card', () => ({ kind: 'bill', legs: [[accounts.card, '-15.49']] })],
  ])('accepts %s', async (_, spec) => {
    await expect(create(spec())).resolves.toMatch(/^[0-9a-f-]{36}$/)
  })

  it.each<[string, () => ItemSpec]>([
    ['a bill with a positive leg', () => ({ kind: 'bill', legs: [[accounts.checking, '95.00']] })],
    ['a bill with two legs', () => ({ kind: 'bill', legs: [[accounts.checking, '-50.00'], [accounts.savings, '-45.00']] })],
    ['income with a negative leg', () => ({ kind: 'income', legs: [[accounts.checking, '100.00'], [accounts.savings, '-20.00']] })],
    ['a transfer that does not net to zero', () => ({ kind: 'transfer', legs: [[accounts.checking, '-200.00'], [accounts.savings, '199.99']] })],
    ['a one-legged transfer', () => ({ kind: 'transfer', legs: [[accounts.checking, '-200.00']] })],
    ['a transfer with both legs the same way', () => ({ kind: 'transfer', legs: [[accounts.checking, '200.00'], [accounts.savings, '-200.00'], [accounts.card, '0.01']] })],
    ['a debt payment with one leg', () => ({ kind: 'debt_payment', legs: [[accounts.checking, '-400.00']] })],
    ['an item with no legs at all', () => ({ kind: 'income', legs: [] })],
  ])('rejects %s at commit', async (_, spec) => {
    await rejectsWith(create(spec()), LEGS_RULE)
  })

  it('checks at commit, so the item can be written before its legs', async () => {
    const id = await asUser(h.db, alice.id, async (trx) => {
      const itemId = await insertItem(trx, alice.id, { kind: 'transfer', legs: [] })
      // Between these two statements the item is invalid; nothing complains.
      await trx.insertInto('core.recurring_item_legs').values([
        { user_id: alice.id, recurring_item_id: itemId, account_id: accounts.checking, amount: '-10.00' },
        { user_id: alice.id, recurring_item_id: itemId, account_id: accounts.savings, amount: '10.00' },
      ]).execute()
      return itemId
    })
    expect(id).toBeDefined()
  })

  it('rejects removing one side of an existing transfer', async () => {
    const id = await create({ kind: 'transfer', legs: [[accounts.checking, '-60.00'], [accounts.savings, '60.00']] })
    await rejectsWith(
      asUser(h.db, alice.id, (trx) =>
        trx.deleteFrom('core.recurring_item_legs')
          .where('recurring_item_id', '=', id).where('account_id', '=', accounts.savings).execute()),
      LEGS_RULE,
    )
  })

  it('rejects changing the kind to one the legs do not fit', async () => {
    const id = await create({ kind: 'income', legs: [[accounts.checking, '10.00'], [accounts.savings, '5.00']] })
    await rejectsWith(
      asUser(h.db, alice.id, (trx) =>
        trx.updateTable('core.recurring_items').set({ kind: 'bill' }).where('id', '=', id).execute()),
      LEGS_RULE,
    )
  })

  it('lets an item be deleted, legs cascading, without tripping the check', async () => {
    const id = await create({ kind: 'transfer', legs: [[accounts.checking, '-5.00'], [accounts.savings, '5.00']] })
    await asUser(h.db, alice.id, (trx) => trx.deleteFrom('core.recurring_items').where('id', '=', id).execute())
    const left = await asUser(h.db, alice.id, (trx) =>
      trx.selectFrom('core.recurring_item_legs').select('id').where('recurring_item_id', '=', id).execute())
    expect(left).toEqual([])
  })

  it('refuses a zero leg and two legs on the same account', async () => {
    await rejectsWith(create({ kind: 'bill', legs: [[accounts.checking, '0.00']] }), 'ck_recurring_item_legs_amount_nonzero')
    await rejectsWith(
      create({ kind: 'transfer', legs: [[accounts.checking, '-1.00'], [accounts.checking, '1.00']] }),
      'uq_recurring_item_legs_item_account',
    )
  })
})

describe('frequencies', () => {
  it('accepts once', async () => {
    await expect(create({ kind: 'bill', frequency: 'once', legs: [[accounts.checking, '-650.00']] })).resolves.toBeDefined()
  })

  it('accepts semimonthly on the 15th and last day', async () => {
    await expect(create({ kind: 'income', frequency: 'semimonthly', semimonthly: [15, 31], legs: [[accounts.checking, '450.00']] }))
      .resolves.toBeDefined()
  })

  it.each<[string, RecurrenceFrequency, readonly [number | null, number | null]]>([
    ['semimonthly without days', 'semimonthly', [null, null]],
    ['semimonthly with one day', 'semimonthly', [1, null]],
    ['semimonthly days out of order', 'semimonthly', [15, 1]],
    ['semimonthly days that collide in February', 'semimonthly', [28, 31]],
    ['semimonthly day 0', 'semimonthly', [0, 15]],
    ['days on a monthly item', 'monthly', [1, 15]],
  ])('refuses %s', async (_, frequency, semimonthly) => {
    await rejectsWith(
      create({ kind: 'bill', frequency, semimonthly, legs: [[accounts.checking, '-1.00']] }),
      'ck_recurring_items_semimonthly_days',
    )
  })
})

describe('isolation', () => {
  it('hides one user\'s legs from another', async () => {
    await create({ kind: 'bill', legs: [[accounts.checking, '-1.00']] })
    const seen = await asUser(h.db, bob.id, (trx) =>
      trx.selectFrom('core.recurring_item_legs').select('id').where('account_id', '=', accounts.checking).execute())
    expect(seen).toEqual([])
  })

  it('refuses a leg on another user\'s account, even on your own item', async () => {
    const error = await asUser(h.db, bob.id, (trx) =>
      insertItem(trx, bob.id, { kind: 'bill', legs: [[accounts.checking, '-1.00']] }),
    ).then(() => undefined, (e: unknown) => e)
    expect((error as { constraint?: string }).constraint).toBe('fk_recurring_item_legs_account_id_owned')
  })

  it('refuses a leg on another user\'s item', async () => {
    const aliceItem = await create({ kind: 'income', legs: [[accounts.checking, '1.00']] })
    const error = await asUser(h.db, bob.id, (trx) =>
      trx.insertInto('core.recurring_item_legs')
        .values({ user_id: bob.id, recurring_item_id: aliceItem, account_id: accounts.bobChecking, amount: '1.00' })
        .execute(),
    ).then(() => undefined, (e: unknown) => e)
    expect((error as { constraint?: string }).constraint).toBe('fk_recurring_item_legs_recurring_item_id_owned')
  })

  it('refuses writing a leg as someone else', async () => {
    const error = await asUser(h.db, bob.id, (trx) =>
      trx.insertInto('core.recurring_item_legs')
        .values({ user_id: alice.id, recurring_item_id: crypto.randomUUID(), account_id: accounts.checking, amount: '1.00' })
        .execute(),
    ).then(() => undefined, (e: unknown) => e)
    expect(String(error)).toMatch(/row-level security/)
  })

  it('forces row-level security on the legs table', async () => {
    const r = await sql<{ forced: boolean }>`
      SELECT relforcerowsecurity AS forced FROM pg_class WHERE oid = 'core.recurring_item_legs'::regclass
    `.execute(owner)
    expect(r.rows[0]?.forced).toBe(true)
  })
})

describe('the backfill from the old one-row shape', () => {
  /** Thrown to roll the owner transaction back once a test has looked. */
  class Rollback extends Error {}

  /**
   * Recreates the pre-021 columns inside a transaction that is always rolled
   * back, inserts `rows` in the old shape, and hands the transaction to `look`.
   */
  async function withOldShape(
    rows: readonly { name: string; account: string; amount: string; transferTo?: string; frequency?: RecurrenceFrequency }[],
    look: (trx: Executor, ids: Record<string, string>) => Promise<void>,
  ): Promise<void> {
    // The migration helpers take an untyped Kysely, as the migrator does.
    const migrator = owner as unknown as Kysely<unknown>
    const outcome = await migrator.transaction().execute(async (trx) => {
      await sql`
        ALTER TABLE core.recurring_items
          DROP CONSTRAINT ck_recurring_items_semimonthly_days,
          ALTER COLUMN kind DROP NOT NULL,
          ADD COLUMN account_id uuid, ADD COLUMN amount numeric(19,4),
          ADD COLUMN transfer_account_id uuid, ADD COLUMN is_income boolean NOT NULL DEFAULT false
      `.execute(trx)
      const ids: Record<string, string> = {}
      await withOwnerBackfillAccess(trx, ['core.recurring_items'], async (t) => {
        for (const row of rows) {
          const r = await sql<{ id: string }>`
            INSERT INTO core.recurring_items
              (user_id, name, frequency, series_start_date, account_id, amount, transfer_account_id, is_income)
            VALUES (${alice.id}, ${row.name}, ${row.frequency ?? 'monthly'}, '2026-01-01',
                    ${row.account}, ${row.amount}, ${row.transferTo ?? null}, ${Number(row.amount) > 0})
            RETURNING id
          `.execute(t)
          ids[row.name] = r.rows[0]!.id
        }
      })
      await look(trx, ids)
      throw new Rollback()
    }).then(() => 'committed', (e: unknown) => (e instanceof Rollback ? 'rolled back' : Promise.reject(e)))
    expect(outcome).toBe('rolled back')
  }

  it('turns every old row into a kind and legs that satisfy the trigger', async () => {
    await withOldShape(
      [
        { name: 'Payroll', account: accounts.checking, amount: '2850.0000' },
        { name: 'Rent', account: accounts.checking, amount: '-1550.0000' },
        { name: 'To savings', account: accounts.checking, amount: '-200.0000', transferTo: accounts.savings },
        // Stored from the receiving side: the positive leg is on savings.
        { name: 'From savings', account: accounts.checking, amount: '75.0000', transferTo: accounts.savings },
        { name: 'Card payment', account: accounts.checking, amount: '-400.0000', transferTo: accounts.card },
        { name: 'Retainer', account: accounts.checking, amount: '450.0000', frequency: 'semimonthly' },
      ],
      async (trx, ids) => {
        const count = await backfillRecurringItemLegs(trx)
        expect(count).toBeGreaterThanOrEqual(6)

        await withOwnerBackfillAccess(trx, ['core.recurring_items', 'core.recurring_item_legs'], async (t) => {
          const items = await sql<{ name: string; kind: string; d1: number | null; d2: number | null; legs: string }>`
            SELECT i.name, i.kind::text AS kind, i.semimonthly_day_1 AS d1, i.semimonthly_day_2 AS d2,
                   string_agg(l.account_id::text || ':' || l.amount::text, ',' ORDER BY l.amount) AS legs
            FROM core.recurring_items i JOIN core.recurring_item_legs l ON l.recurring_item_id = i.id
            WHERE i.id = ANY(${Object.values(ids)}::uuid[])
            GROUP BY i.name, i.kind, i.semimonthly_day_1, i.semimonthly_day_2
          `.execute(t)
          const by = Object.fromEntries(items.rows.map((r) => [r.name, r]))
          expect(by['Payroll']).toMatchObject({ kind: 'income', legs: `${accounts.checking}:2850.0000` })
          expect(by['Rent']).toMatchObject({ kind: 'bill', legs: `${accounts.checking}:-1550.0000` })
          expect(by['To savings']).toMatchObject({
            kind: 'transfer', legs: `${accounts.checking}:-200.0000,${accounts.savings}:200.0000`,
          })
          expect(by['From savings']).toMatchObject({
            kind: 'transfer', legs: `${accounts.savings}:-75.0000,${accounts.checking}:75.0000`,
          })
          expect(by['Card payment']).toMatchObject({
            kind: 'debt_payment', legs: `${accounts.checking}:-400.0000,${accounts.card}:400.0000`,
          })
          expect(by['Retainer']).toMatchObject({ kind: 'income', d1: 1, d2: 15 })

          // Run the deferred trigger now, while the owner can see the rows,
          // so a backfill that produced a bad shape fails here rather than
          // passing because the check saw nothing.
          await sql`SET CONSTRAINTS ${sql.raw(`core.${LEGS_RULE}`)} IMMEDIATE`.execute(t)

          // The constraints the migration adds after the backfill must hold
          // on what it produced (lesson #2: they validate the backfill).
          await sql`ALTER TABLE core.recurring_items ALTER COLUMN kind SET NOT NULL`.execute(t)
          await sql`
            ALTER TABLE core.recurring_items
              ADD CONSTRAINT ck_recurring_items_semimonthly_days ${sql.raw(SEMIMONTHLY_DAYS_CHECK)}
          `.execute(t)
        })
      },
    )
  })

  it('fails loudly, naming the row, on an amount the new model cannot hold', async () => {
    await withOldShape(
      [{ name: 'Zero', account: accounts.checking, amount: '0.0000' }],
      async (trx, ids) => {
        await expect(backfillRecurringItemLegs(trx)).rejects.toThrow(ids['Zero']!)
      },
    )
  })

  it('leaves no backfill policy behind and FORCE on', async () => {
    const r = await sql<{ n: string; forced: boolean }>`
      SELECT (SELECT count(*) FROM pg_policy WHERE polname = 'migration_backfill')::text AS n,
             (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'core.recurring_items'::regclass) AS forced
    `.execute(owner)
    expect(r.rows[0]).toEqual({ n: '0', forced: true })
  })
})
