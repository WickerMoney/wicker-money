import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { auth, createHarness, createUser, type Harness, type TestUser } from '../testing/harness.js'
import { asUser } from '../db/client.js'
import { KyselyAccountRepository } from './repository/KyselyAccountRepository.js'

let h: Harness
let user: TestUser
beforeAll(async () => { h = await createHarness(); user = await createUser(h) })
afterAll(async () => { await h.close() })

async function makeAccount(as: TestUser, over: Record<string, unknown> = {}) {
  const res = await h.app.inject({
    method: 'POST', url: '/api/v1/accounts', headers: auth(as),
    payload: { name: 'Checking', accountType: 'checking', initialBalance: '100.00', ...over },
  })
  expect(res.statusCode).toBe(201)
  return res.json()
}

describe('accounts', () => {
  it('creates an account and reports the opening balance', async () => {
    const account = await makeAccount(user, { name: 'Opening' })
    expect(account.balance).toBe('100.0000')
    expect(account.initialBalance).toBe('100.0000')
  })

  it('derives the balance from the ledger rather than a stored column', async () => {
    const account = await makeAccount(user, { name: 'Derived', initialBalance: '1000.00' })

    for (const amount of ['-25.50', '-4.49', '200.00']) {
      const res = await h.app.inject({
        method: 'POST', url: '/api/v1/transactions', headers: auth(user),
        payload: {
          accountId: account.id, amount, merchant: 'Test',
          transactionDate: '2026-03-01',
        },
      })
      expect(res.statusCode).toBe(201)
    }

    const after = await h.app.inject({
      method: 'GET', url: `/api/v1/accounts/${account.id}`, headers: auth(user),
    })
    // 1000 - 25.50 - 4.49 + 200 = 1170.01, to the cent, with no rounding drift.
    expect(after.json().balance).toBe('1170.0100')
  })

  it('excludes archived accounts by default and includes them on request', async () => {
    const account = await makeAccount(user, { name: 'ToArchive' })
    await h.app.inject({
      method: 'POST', url: `/api/v1/accounts/${account.id}/archive`, headers: auth(user),
    })

    const listed = await h.app.inject({ method: 'GET', url: '/api/v1/accounts', headers: auth(user) })
    expect(listed.json().map((a: { id: string }) => a.id)).not.toContain(account.id)

    const withArchived = await h.app.inject({
      method: 'GET', url: '/api/v1/accounts?includeArchived=true', headers: auth(user),
    })
    expect(withArchived.json().map((a: { id: string }) => a.id)).toContain(account.id)
  })

  describe('?fields=basic', () => {
    const list = (query: string, as = user) =>
      h.app.inject({ method: 'GET', url: `/api/v1/accounts${query}`, headers: auth(as) })

    it('returns names and kinds without any balance, and leaves the default shape alone', async () => {
      const u = await createUser(h)
      const account = await makeAccount(u, { name: 'Basic', initialBalance: '10.00' })

      const basic = await list('?fields=basic', u)
      expect(basic.statusCode).toBe(200)
      expect(basic.json()).toEqual([{
        id: account.id, name: 'Basic', accountType: 'checking', currencyCode: 'USD',
        spendable: true, archivedAt: null,
      }])

      const full = (await list('', u)).json()
      expect(full[0]).toMatchObject({ id: account.id, balance: '10.0000', initialBalance: '10.0000', bufferAmount: '0.0000' })
      expect((await list('?fields=full', u)).json()).toEqual(full)
    })

    it('orders by name, and honours includeArchived', async () => {
      const u = await createUser(h)
      await makeAccount(u, { name: 'Zed' })
      const gone = await makeAccount(u, { name: 'Alpha' })
      await makeAccount(u, { name: 'Mid' })
      await h.app.inject({ method: 'POST', url: `/api/v1/accounts/${gone.id}/archive`, headers: auth(u) })

      const names = async (q: string) => (await list(q, u)).json().map((a: { name: string }) => a.name)
      expect(await names('?fields=basic')).toEqual(['Mid', 'Zed'])
      expect(await names('?fields=basic&includeArchived=true')).toEqual(['Alpha', 'Mid', 'Zed'])
    })

    it('rejects an unknown fields value', async () => {
      const res = await list('?fields=everything')
      expect(res.statusCode).toBe(400)
      expect(res.json().code).toBe('validation_failed')
    })

    it('is scoped to the signed-in user', async () => {
      const other = await createUser(h)
      await makeAccount(other, { name: 'Not yours' })
      const names = (await list('?fields=basic')).json().map((a: { name: string }) => a.name)
      expect(names).not.toContain('Not yours')
    })

    it('never reads the transactions table, while the full list does', async () => {
      const u = await createUser(h)
      const account = await makeAccount(u, { name: 'Ledgered' })
      await h.app.inject({
        method: 'POST', url: '/api/v1/transactions', headers: auth(u),
        payload: { accountId: account.id, amount: '-5.00', merchant: 'Test', transactionDate: '2026-03-01' },
      })

      // Per-transaction scan counters: they reset with each transaction and are
      // visible straight away, so the count is exactly what this one read touched.
      const scans = async (read: (repo: KyselyAccountRepository) => Promise<unknown>) =>
        asUser(h.db, u.id, async (trx) => {
          const count = async () => {
            const { rows } = await sql<{ scans: string }>`
              SELECT COALESCE(SUM(seq_scan + idx_scan), 0)::text AS scans
              FROM pg_stat_xact_user_tables WHERE schemaname = 'core' AND relname = 'transactions'
            `.execute(trx)
            return Number(rows[0]?.scans)
          }
          const before = await count()
          await read(new KyselyAccountRepository(trx))
          return (await count()) - before
        })

      expect(await scans((repo) => repo.listBasic(false))).toBe(0)
      expect(await scans((repo) => repo.listWithBalances(false))).toBeGreaterThan(0)
    })
  })

  it('rejects an unknown account type', async () => {
    const res = await h.app.inject({
      method: 'POST', url: '/api/v1/accounts', headers: auth(user),
      payload: { name: 'Nope', accountType: 'crypto' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('404s an account that does not exist', async () => {
    const res = await h.app.inject({
      method: 'GET', headers: auth(user),
      url: '/api/v1/accounts/00000000-0000-0000-0000-000000000000',
    })
    expect(res.statusCode).toBe(404)
  })
})

/**
 * The isolation test. This is the load-bearing test of the permission model: if it ever
 * fails, the plugin permission model built on top of it is worthless.
 */
describe('tenant isolation', () => {
  it('hides one user\'s accounts from another', async () => {
    const alice = await createUser(h)
    const bob = await createUser(h)
    const aliceAccount = await makeAccount(alice, { name: "Alice's savings" })

    const bobList = await h.app.inject({
      method: 'GET', url: '/api/v1/accounts', headers: auth(bob),
    })
    expect(bobList.json().map((a: { id: string }) => a.id)).not.toContain(aliceAccount.id)
  })

  it("404s when one user fetches another's account by id", async () => {
    const alice = await createUser(h)
    const bob = await createUser(h)
    const aliceAccount = await makeAccount(alice)

    const res = await h.app.inject({
      method: 'GET', url: `/api/v1/accounts/${aliceAccount.id}`, headers: auth(bob),
    })
    // Not 403: revealing that the id exists would itself leak information.
    expect(res.statusCode).toBe(404)
  })

  it("refuses to let one user modify another's account", async () => {
    const alice = await createUser(h)
    const bob = await createUser(h)
    const aliceAccount = await makeAccount(alice)

    const res = await h.app.inject({
      method: 'PATCH', url: `/api/v1/accounts/${aliceAccount.id}`, headers: auth(bob),
      payload: { name: 'Owned by Bob now' },
    })
    expect(res.statusCode).toBe(404)

    const stillAlices = await h.app.inject({
      method: 'GET', url: `/api/v1/accounts/${aliceAccount.id}`, headers: auth(alice),
    })
    expect(stillAlices.json().name).toBe('Checking')
  })
})

async function newTransaction(accountId: string, amount: string, u = user, merchant = 'Test') {
  const res = await h.app.inject({
    method: 'POST', url: '/api/v1/transactions', headers: auth(u),
    payload: { accountId, merchant, amount, transactionDate: '2026-03-01' },
  })
  expect(res.statusCode).toBe(201)
  return (res.json() as { id: string }).id
}

/** Inserts a one-leg bill on `accountId`; `over` overrides item columns. */
async function newRecurring(accountId: string, over: Record<string, unknown> = {}, u = user) {
  return asUser(h.db, u.id, async (trx) => {
    const item = await trx
      .insertInto('core.recurring_items')
      .values({
        user_id: u.id,
        name: 'Recurring',
        kind: 'bill',
        frequency: 'monthly',
        series_start_date: '2026-01-01',
        ...over,
      })
      .returning('id')
      .executeTakeFirstOrThrow()
    await trx
      .insertInto('core.recurring_item_legs')
      .values({ user_id: u.id, recurring_item_id: item.id, account_id: accountId, amount: '-10.00' })
      .execute()
    return item
  })
}

/** Inserts a recurring item of any kind with the given legs; returns its id. */
async function newRecurringWithLegs(
  kind: 'income' | 'bill' | 'debt_payment' | 'transfer',
  legs: ReadonlyArray<readonly [accountId: string, amount: string]>,
  u = user,
): Promise<string> {
  return asUser(h.db, u.id, async (trx) => {
    const item = await trx
      .insertInto('core.recurring_items')
      .values({ user_id: u.id, name: `Recurring ${kind}`, kind, frequency: 'monthly', series_start_date: '2026-01-01' })
      .returning('id')
      .executeTakeFirstOrThrow()
    await trx
      .insertInto('core.recurring_item_legs')
      .values(legs.map(([accountId, amount]) => ({ user_id: u.id, recurring_item_id: item.id, account_id: accountId, amount })))
      .execute()
    return item.id
  })
}

/** Every leg of the given items as `item → { account → amount }`. */
async function legsOf(itemIds: readonly string[], u = user): Promise<Record<string, Record<string, string>>> {
  const rows = await asUser(h.db, u.id, (trx) =>
    trx.selectFrom('core.recurring_item_legs')
      .select(['recurring_item_id', 'account_id', 'amount'])
      .where('recurring_item_id', 'in', [...itemIds])
      .execute(),
  )
  const out: Record<string, Record<string, string>> = {}
  for (const r of rows) (out[r.recurring_item_id] ??= {})[r.account_id] = r.amount
  return out
}

async function doTransfer(fromAccountId: string, toAccountId: string, amount: string, u = user) {
  const res = await h.app.inject({
    method: 'POST', url: '/api/v1/transactions/transfer', headers: auth(u),
    payload: { fromAccountId, toAccountId, amount, transactionDate: '2026-03-01' },
  })
  expect(res.statusCode).toBe(201)
  return res.json()
}

interface Usage { total: number; by: Array<{ table: string; count: number }>; unreadable: string[] }

async function usageOf(accountId: string, u = user): Promise<Usage> {
  const res = await h.app.inject({ method: 'GET', url: `/api/v1/accounts/${accountId}/usage`, headers: auth(u) })
  expect(res.statusCode).toBe(200)
  return res.json() as Usage
}

describe('account usage', () => {
  it('reports zero usage for a fresh account', async () => {
    const a = await makeAccount(user, { name: 'Fresh' })
    expect((await usageOf(a.id)).total).toBe(0)
  })

  it('counts plain transactions and recurring items', async () => {
    const a = await makeAccount(user, { name: 'PlainUsage' })
    await newTransaction(a.id, '-5.00')
    await newRecurring(a.id)

    const usage = await usageOf(a.id)
    expect(usage.total).toBe(2)
    expect(usage.by).toEqual(
      expect.arrayContaining([
        { table: 'core.transactions', count: 1 },
        // Items reach accounts through their legs.
        { table: 'core.recurring_item_legs', count: 1 },
      ]),
    )
  })

  it('counts a transfer leg living on the OTHER account as usage of this account too, without listing the table twice', async () => {
    const a = await makeAccount(user, { name: 'TransferUsageA' })
    const b = await makeAccount(user, { name: 'TransferUsageB' })
    await doTransfer(a.id, b.id, '15.00')

    const usageA = await usageOf(a.id)
    const usageB = await usageOf(b.id)
    // Each account's own leg (account_id) plus the sibling leg's counterparty
    // reference (transfer_account_id) -- two rows, one line in `by`, never two.
    expect(usageA.total).toBe(2)
    expect(usageA.by).toEqual([{ table: 'core.transactions', count: 2 }])
    expect(usageB.total).toBe(2)
    expect(usageB.by).toEqual([{ table: 'core.transactions', count: 2 }])
  })
})

describe('DELETE /accounts/:id', () => {
  it('deletes an account with no history', async () => {
    const a = await makeAccount(user, { name: 'ToDelete' })
    const res = await h.app.inject({ method: 'DELETE', url: `/api/v1/accounts/${a.id}`, headers: auth(user) })
    expect(res.statusCode).toBe(204)

    const after = await h.app.inject({ method: 'GET', url: `/api/v1/accounts/${a.id}`, headers: auth(user) })
    expect(after.statusCode).toBe(404)
  })

  it('refuses to delete an account with history', async () => {
    const a = await makeAccount(user, { name: 'HasHistory' })
    await newTransaction(a.id, '-5.00')

    const res = await h.app.inject({ method: 'DELETE', url: `/api/v1/accounts/${a.id}`, headers: auth(user) })
    expect(res.statusCode).toBe(409)
    expect(res.json().code).toBe('account_in_use')
  })
})

describe('POST /accounts/:id/delete-with-history', () => {
  it('rejects a stale confirmCount', async () => {
    const a = await makeAccount(user, { name: 'Stale' })
    await newTransaction(a.id, '-5.00')

    const res = await h.app.inject({
      method: 'POST', url: `/api/v1/accounts/${a.id}/delete-with-history`, headers: auth(user),
      payload: { confirmCount: 0 },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().code).toBe('usage_changed')
  })

  it('removes both legs of a transfer, even the leg on another account, then deletes the account', async () => {
    const a = await makeAccount(user, { name: 'DeleteWithHistoryA' })
    const b = await makeAccount(user, { name: 'DeleteWithHistoryB' })
    await newTransaction(a.id, '-5.00')
    await doTransfer(a.id, b.id, '15.00')

    const before = await usageOf(a.id)
    expect(before.total).toBe(3) // plain txn + own leg + b's leg via transfer_account_id

    const res = await h.app.inject({
      method: 'POST', url: `/api/v1/accounts/${a.id}/delete-with-history`, headers: auth(user),
      payload: { confirmCount: before.total },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().deletedTransactions).toBe(3)

    const gone = await h.app.inject({ method: 'GET', url: `/api/v1/accounts/${a.id}`, headers: auth(user) })
    expect(gone.statusCode).toBe(404)

    // B's balance no longer reflects the half of the transfer that was deleted
    // along with A -- back to its opening balance.
    const bAfter = await h.app.inject({ method: 'GET', url: `/api/v1/accounts/${b.id}`, headers: auth(user) })
    expect(bAfter.json().balance).toBe('100.0000')
  })
})

describe('POST /accounts/:id/migrate', () => {
  it('blocks a currency mismatch', async () => {
    const a = await makeAccount(user, { name: 'USDAcct', currencyCode: 'USD' })
    const b = await makeAccount(user, { name: 'EURAcct', currencyCode: 'EUR' })

    const res = await h.app.inject({
      method: 'POST', url: `/api/v1/accounts/${a.id}/migrate/preview`, headers: auth(user),
      payload: { toAccountId: b.id },
    })
    expect(res.statusCode).toBe(400)
  })

  it('moves plain transactions and recurring items, then deletes the source account', async () => {
    const a = await makeAccount(user, { name: 'MigrateFrom' })
    const b = await makeAccount(user, { name: 'MigrateTo' })
    const txnId = await newTransaction(a.id, '-5.00')
    await newRecurring(a.id)

    const preview = await h.app.inject({
      method: 'POST', url: `/api/v1/accounts/${a.id}/migrate/preview`, headers: auth(user),
      payload: { toAccountId: b.id },
    })
    expect(preview.statusCode).toBe(200)
    const plan = preview.json()
    expect(plan.movedTransactions).toBe(1)
    expect(plan.movedRecurringItems).toBe(1)
    expect(plan.removedTransferTransactions).toBe(0)
    expect(plan.removedTransferRecurringItems).toBe(0)

    const commit = await h.app.inject({
      method: 'POST', url: `/api/v1/accounts/${a.id}/migrate`, headers: auth(user),
      payload: { toAccountId: b.id, confirmCount: plan.totalAffected },
    })
    expect(commit.statusCode).toBe(200)

    const gone = await h.app.inject({ method: 'GET', url: `/api/v1/accounts/${a.id}`, headers: auth(user) })
    expect(gone.statusCode).toBe(404)

    const moved = await asUser(h.db, user.id, async (trx) =>
      trx.selectFrom('core.transactions').select('account_id').where('id', '=', txnId).executeTakeFirst(),
    )
    expect(moved?.account_id).toBe(b.id)
  })

  it('collapses a transfer recorded between the two accounts being merged, rather than leaving a self-transfer', async () => {
    const a = await makeAccount(user, { name: 'MergeA' })
    const b = await makeAccount(user, { name: 'MergeB' })
    await doTransfer(a.id, b.id, '25.00')
    await newTransaction(a.id, '-5.00')

    const preview = await h.app.inject({
      method: 'POST', url: `/api/v1/accounts/${a.id}/migrate/preview`, headers: auth(user),
      payload: { toAccountId: b.id },
    })
    const plan = preview.json()
    expect(plan.removedTransferTransactions).toBe(2)
    expect(plan.movedTransactions).toBe(1)

    const commit = await h.app.inject({
      method: 'POST', url: `/api/v1/accounts/${a.id}/migrate`, headers: auth(user),
      payload: { toAccountId: b.id, confirmCount: plan.totalAffected },
    })
    expect(commit.statusCode).toBe(200)

    const bad = await asUser(h.db, user.id, async (trx) =>
      sql<{ n: string }>`
        SELECT count(*)::text AS n FROM core.transactions WHERE account_id = transfer_account_id
      `.execute(trx),
    )
    expect(Number(bad.rows[0]?.n ?? 0)).toBe(0)

    // B started at 100: the +25 transfer collapses away entirely (both legs
    // removed, net zero), then the ordinary -5 transaction moves in.
    const bAfter = await h.app.inject({ method: 'GET', url: `/api/v1/accounts/${b.id}`, headers: auth(user) })
    expect(bAfter.json().balance).toBe('95.0000')
  })

  it('rejects a stale confirmCount', async () => {
    const a = await makeAccount(user, { name: 'MigrateStaleA' })
    const b = await makeAccount(user, { name: 'MigrateStaleB' })

    const res = await h.app.inject({
      method: 'POST', url: `/api/v1/accounts/${a.id}/migrate`, headers: auth(user),
      payload: { toAccountId: b.id, confirmCount: 99 },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().code).toBe('usage_changed')
  })
})

describe('POST /accounts/:id/initial-balance', () => {
  it('previews the shift without changing anything', async () => {
    const a = await makeAccount(user, { name: 'PreviewBalance', initialBalance: '500.00' })
    await newTransaction(a.id, '-50.00')

    const preview = await h.app.inject({
      method: 'POST', url: `/api/v1/accounts/${a.id}/initial-balance/preview`, headers: auth(user),
      payload: { initialBalance: '300.00' },
    })
    expect(preview.statusCode).toBe(200)
    const body = preview.json()
    expect(body.currentInitialBalance).toBe('500.0000')
    expect(body.currentBalance).toBe('450.0000')
    expect(body.newInitialBalance).toBe('300.0000')
    expect(body.newBalance).toBe('250.0000')
    expect(body.delta).toBe('-200.0000')

    const unchanged = await h.app.inject({ method: 'GET', url: `/api/v1/accounts/${a.id}`, headers: auth(user) })
    expect(unchanged.json().initialBalance).toBe('500.0000')
  })

  it('commits the new opening balance and shifts the derived balance retroactively', async () => {
    const a = await makeAccount(user, { name: 'CommitBalance', initialBalance: '500.00' })
    await newTransaction(a.id, '-50.00')

    const res = await h.app.inject({
      method: 'POST', url: `/api/v1/accounts/${a.id}/initial-balance`, headers: auth(user),
      payload: { initialBalance: '300.00' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().initialBalance).toBe('300.0000')
    expect(res.json().balance).toBe('250.0000')
  })

  it('handles a positive delta the same way', async () => {
    const a = await makeAccount(user, { name: 'PositiveDelta', initialBalance: '100.00' })
    const res = await h.app.inject({
      method: 'POST', url: `/api/v1/accounts/${a.id}/initial-balance`, headers: auth(user),
      payload: { initialBalance: '1000.00' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().balance).toBe('1000.0000')
  })
})

describe('tenant isolation for the new account endpoints', () => {
  it("404s usage, delete, delete-with-history, migrate and initial-balance for another user's account", async () => {
    const alice = await createUser(h)
    const bob = await createUser(h)
    const aliceAccount = await makeAccount(alice)
    const bobAccount = await makeAccount(bob)

    const usageRes = await h.app.inject({
      method: 'GET', url: `/api/v1/accounts/${aliceAccount.id}/usage`, headers: auth(bob),
    })
    expect(usageRes.statusCode).toBe(404)

    const delRes = await h.app.inject({
      method: 'DELETE', url: `/api/v1/accounts/${aliceAccount.id}`, headers: auth(bob),
    })
    expect(delRes.statusCode).toBe(404)

    const dwhRes = await h.app.inject({
      method: 'POST', url: `/api/v1/accounts/${aliceAccount.id}/delete-with-history`, headers: auth(bob),
      payload: { confirmCount: 0 },
    })
    expect(dwhRes.statusCode).toBe(404)

    const migRes = await h.app.inject({
      method: 'POST', url: `/api/v1/accounts/${aliceAccount.id}/migrate`, headers: auth(bob),
      payload: { toAccountId: bobAccount.id, confirmCount: 0 },
    })
    expect(migRes.statusCode).toBe(404)

    const balRes = await h.app.inject({
      method: 'POST', url: `/api/v1/accounts/${aliceAccount.id}/initial-balance`, headers: auth(bob),
      payload: { initialBalance: '1.00' },
    })
    expect(balRes.statusCode).toBe(404)

    const stillThere = await h.app.inject({
      method: 'GET', url: `/api/v1/accounts/${aliceAccount.id}`, headers: auth(alice),
    })
    expect(stillThere.statusCode).toBe(200)
  })
})

describe('PATCH /accounts/:id', () => {
  async function patch(id: string, payload: Record<string, unknown>, as = user) {
    return h.app.inject({ method: 'PATCH', url: `/api/v1/accounts/${id}`, headers: auth(as), payload })
  }

  it('changes the account type', async () => {
    const account = await makeAccount(user, { name: 'TypeChange' })
    const res = await patch(account.id, { accountType: 'savings' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ accountType: 'savings', name: 'TypeChange', currencyCode: 'USD' })
  })

  it('changes the currency, normalising the code to upper case', async () => {
    const account = await makeAccount(user, { name: 'CurrencyChange' })
    const res = await patch(account.id, { currencyCode: 'eur' })
    expect(res.statusCode).toBe(200)
    expect(res.json().currencyCode).toBe('EUR')
  })

  it('defaults spendable by type, reports it, and lets it be turned off and on', async () => {
    const checking = await makeAccount(user, { name: 'SpendChecking' })
    const savings = await makeAccount(user, { name: 'SpendSavings', accountType: 'savings' })
    expect(checking.spendable).toBe(true)
    expect(savings.spendable).toBe(false)

    expect((await patch(checking.id, { spendable: false })).json().spendable).toBe(false)
    expect((await patch(savings.id, { spendable: true })).json().spendable).toBe(true)
  })

  it('refuses a spendable card with 400 and names the rule', async () => {
    const created = await h.app.inject({
      method: 'POST', url: '/api/v1/accounts', headers: auth(user),
      payload: { name: 'SpendCard', accountType: 'credit_card', spendable: true },
    })
    expect(created.statusCode).toBe(400)
    expect(created.json().message).toMatch(/only checking and savings/)

    const card = await makeAccount(user, { name: 'SpendCard2', accountType: 'credit_card' })
    expect((await patch(card.id, { spendable: true })).statusCode).toBe(400)
  })

  it('clears spendable when a spendable account becomes a loan', async () => {
    const account = await makeAccount(user, { name: 'SpendToLoan' })
    const res = await patch(account.id, { accountType: 'loan' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ accountType: 'loan', spendable: false })
  })

  it('changes the buffer amount at the storage scale', async () => {
    const account = await makeAccount(user, { name: 'BufferChange' })
    const res = await patch(account.id, { bufferAmount: '250.5' })
    expect(res.statusCode).toBe(200)
    expect(res.json().bufferAmount).toBe('250.5000')
  })

  it('leaves fields that are not in the body untouched, including ones that have creation defaults', async () => {
    const account = await makeAccount(user, {
      name: 'KeepFields', accountType: 'savings', currencyCode: 'EUR', bufferAmount: '75.00',
    })
    const res = await patch(account.id, { name: 'Renamed' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      name: 'Renamed', accountType: 'savings', currencyCode: 'EUR', bufferAmount: '75.0000', initialBalance: '100.0000',
    })
  })

  it('does not accept an opening balance change', async () => {
    const account = await makeAccount(user, { name: 'NoOpening' })
    const res = await patch(account.id, { initialBalance: '5.00' })
    expect(res.statusCode).toBe(200)
    expect(res.json().initialBalance).toBe('100.0000')
  })

  it('rejects an invalid type, currency length and buffer with 400', async () => {
    const account = await makeAccount(user, { name: 'BadPatch' })
    expect((await patch(account.id, { accountType: 'crypto' })).statusCode).toBe(400)
    expect((await patch(account.id, { currencyCode: 'EURO' })).statusCode).toBe(400)
    expect((await patch(account.id, { bufferAmount: '1.23456' })).statusCode).toBe(400)
    const negative = await patch(account.id, { bufferAmount: '-5' })
    expect(negative.statusCode).toBe(400)
    expect(negative.json().message).toMatch(/Buffer cannot be negative/)
  })

  it('answers 400 rather than 500 for an id that is not a UUID', async () => {
    const res = await patch('not-a-uuid', { name: 'x' })
    expect(res.statusCode).toBe(400)
  })
})

describe('malformed ids', () => {
  it('answers 400 rather than 500 on every :id route', async () => {
    const routes: Array<[string, string, Record<string, unknown> | undefined]> = [
      ['GET', '/api/v1/accounts/nope', undefined],
      ['POST', '/api/v1/accounts/nope/archive', undefined],
      ['GET', '/api/v1/accounts/nope/usage', undefined],
      ['DELETE', '/api/v1/accounts/nope', undefined],
      ['POST', '/api/v1/accounts/nope/delete-with-history', { confirmCount: 0 }],
      ['POST', '/api/v1/accounts/nope/initial-balance', { initialBalance: '1' }],
      ['POST', '/api/v1/accounts/nope/initial-balance/preview', { initialBalance: '1' }],
    ]
    for (const [method, url, payload] of routes) {
      const res = await h.app.inject({ method: method as 'GET', url, headers: auth(user), payload })
      expect(res.statusCode, `${method} ${url}`).toBe(400)
    }
  })
})

describe('POST /accounts/:id/migrate edge cases', () => {
  async function insertWithExternalId(accountId: string, externalId: string) {
    await asUser(h.db, user.id, async (trx) =>
      trx
        .insertInto('core.transactions')
        .values({
          user_id: user.id, account_id: accountId, amount: '-1.00', merchant: 'Imported',
          transaction_date: '2026-03-01', external_id: externalId,
        })
        .execute(),
    )
  }

  it('answers 409 external_id_collision naming both accounts, and changes nothing', async () => {
    const a = await makeAccount(user, { name: 'CollideFrom' })
    const b = await makeAccount(user, { name: 'CollideTo' })
    await insertWithExternalId(a.id, 'bank-ref-1')
    await insertWithExternalId(b.id, 'bank-ref-1')

    const res = await h.app.inject({
      method: 'POST', url: `/api/v1/accounts/${a.id}/migrate`, headers: auth(user),
      payload: { toAccountId: b.id, confirmCount: 1 },
    })

    expect(res.statusCode).toBe(409)
    expect(res.json().code).toBe('external_id_collision')
    expect(res.json().message).toContain("'CollideFrom' and 'CollideTo'")

    // The failed statement rolled the whole unit of work back.
    const source = await h.app.inject({ method: 'GET', url: `/api/v1/accounts/${a.id}`, headers: auth(user) })
    expect(source.statusCode).toBe(200)
    expect(source.json().balance).toBe('99.0000')
    const target = await h.app.inject({ method: 'GET', url: `/api/v1/accounts/${b.id}`, headers: auth(user) })
    expect(target.json().balance).toBe('99.0000')
  })

  it('answers 404 and leaves everything alone when the target belongs to another user', async () => {
    const alice = await createUser(h)
    const bob = await createUser(h)
    const aliceAccount = await makeAccount(alice, { name: 'AliceSource' })
    const bobAccount = await makeAccount(bob, { name: 'BobTarget' })
    await newTransaction(aliceAccount.id, '-5.00', alice)

    const commit = await h.app.inject({
      method: 'POST', url: `/api/v1/accounts/${aliceAccount.id}/migrate`, headers: auth(alice),
      payload: { toAccountId: bobAccount.id, confirmCount: 1 },
    })
    expect(commit.statusCode).toBe(404)

    const preview = await h.app.inject({
      method: 'POST', url: `/api/v1/accounts/${aliceAccount.id}/migrate/preview`, headers: auth(alice),
      payload: { toAccountId: bobAccount.id },
    })
    expect(preview.statusCode).toBe(404)

    const source = await h.app.inject({ method: 'GET', url: `/api/v1/accounts/${aliceAccount.id}`, headers: auth(alice) })
    expect(source.json().balance).toBe('95.0000')
    const target = await h.app.inject({ method: 'GET', url: `/api/v1/accounts/${bobAccount.id}`, headers: auth(bob) })
    expect(target.json().balance).toBe('100.0000')
  })

  it('answers 400 when the target is the source account', async () => {
    const a = await makeAccount(user, { name: 'SelfMigrate' })
    for (const url of [`/api/v1/accounts/${a.id}/migrate/preview`, `/api/v1/accounts/${a.id}/migrate`]) {
      const res = await h.app.inject({
        method: 'POST', url, headers: auth(user), payload: { toAccountId: a.id, confirmCount: 0 },
      })
      expect(res.statusCode, url).toBe(400)
    }
  })
})

describe('cross-user isolation on previews, archive and the remaining endpoints', () => {
  it("404s both preview endpoints, archive, usage and delete for another user's account, and changes nothing", async () => {
    const alice = await createUser(h)
    const bob = await createUser(h)
    const aliceAccount = await makeAccount(alice, { name: 'AliceOnly' })
    const bobAccount = await makeAccount(bob, { name: 'BobOnly' })

    const calls: Array<[string, string, Record<string, unknown> | undefined]> = [
      ['POST', `/api/v1/accounts/${aliceAccount.id}/initial-balance/preview`, { initialBalance: '1.00' }],
      ['POST', `/api/v1/accounts/${aliceAccount.id}/migrate/preview`, { toAccountId: bobAccount.id }],
      // Bob's own account as the source, Alice's as the target.
      ['POST', `/api/v1/accounts/${bobAccount.id}/migrate/preview`, { toAccountId: aliceAccount.id }],
      ['POST', `/api/v1/accounts/${aliceAccount.id}/archive`, undefined],
      ['GET', `/api/v1/accounts/${aliceAccount.id}/usage`, undefined],
      ['DELETE', `/api/v1/accounts/${aliceAccount.id}`, undefined],
    ]
    for (const [method, url, payload] of calls) {
      const res = await h.app.inject({ method: method as 'GET', url, headers: auth(bob), payload })
      expect(res.statusCode, `${method} ${url}`).toBe(404)
    }

    const stillActive = await h.app.inject({ method: 'GET', url: `/api/v1/accounts/${aliceAccount.id}`, headers: auth(alice) })
    expect(stillActive.statusCode).toBe(200)
    expect(stillActive.json().archivedAt).toBeNull()
  })

  it('archives once, then 404s a second archive of the same account', async () => {
    const account = await makeAccount(user, { name: 'ArchiveTwice' })
    const first = await h.app.inject({ method: 'POST', url: `/api/v1/accounts/${account.id}/archive`, headers: auth(user) })
    expect(first.statusCode).toBe(200)
    expect(first.json().archivedAt).not.toBeNull()
    const second = await h.app.inject({ method: 'POST', url: `/api/v1/accounts/${account.id}/archive`, headers: auth(user) })
    expect(second.statusCode).toBe(404)
    expect(second.json().message).toBe('Active account not found.')
  })
})

describe('archived accounts', () => {
  // Pins current behavior: archiving only hides an account from the default
  // list. It does not close it to new activity, so a late-arriving import or a
  // manual entry against a closed account is still recorded and still counts
  // toward the (hidden) account's balance.
  it('still accepts a transaction, which changes the balance of the hidden account', async () => {
    const account = await makeAccount(user, { name: 'ArchivedThenPosted' })
    await h.app.inject({ method: 'POST', url: `/api/v1/accounts/${account.id}/archive`, headers: auth(user) })

    const posted = await h.app.inject({
      method: 'POST', url: '/api/v1/transactions', headers: auth(user),
      payload: { accountId: account.id, amount: '-10.00', merchant: 'Late', transactionDate: '2026-03-01' },
    })
    expect(posted.statusCode).toBe(201)

    const after = await h.app.inject({ method: 'GET', url: `/api/v1/accounts/${account.id}`, headers: auth(user) })
    expect(after.json().balance).toBe('90.0000')
    expect(after.json().archivedAt).not.toBeNull()
  })
})

describe('balances at the edges of the money range', () => {
  const MAX = '999999999999999.9999'

  it('sums 15-digit values exactly, past the 15-digit range, with no float rounding', async () => {
    const account = await makeAccount(user, { name: 'BigPositive', initialBalance: MAX })
    await newTransaction(account.id, MAX)
    await newTransaction(account.id, '0.0001')

    const res = await h.app.inject({ method: 'GET', url: `/api/v1/accounts/${account.id}`, headers: auth(user) })
    expect(res.json().balance).toBe('1999999999999999.9999')
    expect(res.json().initialBalance).toBe(MAX)
  })

  it('reports negative balances exactly, including when they cross zero', async () => {
    const account = await makeAccount(user, { name: 'BigNegative', initialBalance: `-${MAX}` })
    await newTransaction(account.id, '-1.0001')
    const res = await h.app.inject({ method: 'GET', url: `/api/v1/accounts/${account.id}`, headers: auth(user) })
    expect(res.json().balance).toBe('-1000000000000001.0000')

    const crossing = await makeAccount(user, { name: 'CrossZero', initialBalance: '0.0001' })
    await newTransaction(crossing.id, '-0.0002')
    const after = await h.app.inject({ method: 'GET', url: `/api/v1/accounts/${crossing.id}`, headers: auth(user) })
    expect(after.json().balance).toBe('-0.0001')
  })

  it('lists the same exact balances as the single-account read', async () => {
    const account = await makeAccount(user, { name: 'ListedBig', initialBalance: MAX })
    await newTransaction(account.id, '-0.0001')
    const listed = await h.app.inject({ method: 'GET', url: '/api/v1/accounts', headers: auth(user) })
    const found = (listed.json() as Array<{ id: string; balance: string }>).find((a) => a.id === account.id)
    expect(found?.balance).toBe('999999999999999.9998')
  })

  it('previews and commits an opening balance change at the extremes exactly', async () => {
    const account = await makeAccount(user, { name: 'BigPreview', initialBalance: MAX })
    await newTransaction(account.id, '-0.0001')

    const preview = await h.app.inject({
      method: 'POST', url: `/api/v1/accounts/${account.id}/initial-balance/preview`, headers: auth(user),
      payload: { initialBalance: `-${MAX}` },
    })
    expect(preview.statusCode).toBe(200)
    expect(preview.json()).toEqual({
      currentInitialBalance: MAX,
      currentBalance: '999999999999999.9998',
      newInitialBalance: `-${MAX}`,
      newBalance: '-1000000000000000.0000',
      delta: '-1999999999999999.9998',
    })

    const commit = await h.app.inject({
      method: 'POST', url: `/api/v1/accounts/${account.id}/initial-balance`, headers: auth(user),
      payload: { initialBalance: `-${MAX}` },
    })
    expect(commit.json().balance).toBe('-1000000000000000.0000')
  })

  it('refuses an opening balance beyond 15 integer digits or 4 decimals', async () => {
    const account = await makeAccount(user, { name: 'TooBig' })
    for (const initialBalance of ['1000000000000000', '0.00001', '1e3']) {
      const res = await h.app.inject({
        method: 'POST', url: `/api/v1/accounts/${account.id}/initial-balance/preview`, headers: auth(user),
        payload: { initialBalance },
      })
      expect(res.statusCode, initialBalance).toBe(400)
    }
  })
})

describe('recurring items when accounts are merged or deleted', () => {
  it('deletes a transfer between the two, sums a split paycheck, and moves the rest', async () => {
    const a = await makeAccount(user, { name: 'RecurMergeA' })
    const b = await makeAccount(user, { name: 'RecurMergeB' })
    const other = await makeAccount(user, { name: 'RecurMergeOther', accountType: 'savings' })
    const between = await newRecurringWithLegs('transfer', [[a.id, '-100.00'], [b.id, '100.00']])
    const split = await newRecurringWithLegs('income', [[a.id, '300.00'], [b.id, '1200.00']])
    const bill = await newRecurringWithLegs('bill', [[a.id, '-45.00']])
    const toSavings = await newRecurringWithLegs('transfer', [[a.id, '-50.00'], [other.id, '50.00']])

    const preview = await h.app.inject({
      method: 'POST', url: `/api/v1/accounts/${a.id}/migrate/preview`, headers: auth(user),
      payload: { toAccountId: b.id },
    })
    const plan = preview.json()
    // Counted per item, not per leg.
    expect(plan.removedTransferRecurringItems).toBe(1)
    expect(plan.movedRecurringItems).toBe(3)

    const commit = await h.app.inject({
      method: 'POST', url: `/api/v1/accounts/${a.id}/migrate`, headers: auth(user),
      payload: { toAccountId: b.id, confirmCount: plan.totalAffected },
    })
    expect(commit.statusCode).toBe(200)

    const legs = await legsOf([between, split, bill, toSavings])
    expect(legs[between]).toBeUndefined()
    // Same total paid, now in one leg (legs are one per account per item).
    expect(legs[split]).toEqual({ [b.id]: '1500.0000' })
    expect(legs[bill]).toEqual({ [b.id]: '-45.0000' })
    expect(legs[toSavings]).toEqual({ [b.id]: '-50.0000', [other.id]: '50.0000' })
  })

  it('also removes a debt payment between the two accounts', async () => {
    const checking = await makeAccount(user, { name: 'RecurMergeChecking' })
    const card = await makeAccount(user, { name: 'RecurMergeCard', accountType: 'credit_card' })
    const payment = await newRecurringWithLegs('debt_payment', [[checking.id, '-400.00'], [card.id, '400.00']])

    const preview = await h.app.inject({
      method: 'POST', url: `/api/v1/accounts/${card.id}/migrate/preview`, headers: auth(user),
      payload: { toAccountId: checking.id },
    })
    expect(preview.json().removedTransferRecurringItems).toBe(1)
    await h.app.inject({
      method: 'POST', url: `/api/v1/accounts/${card.id}/migrate`, headers: auth(user),
      payload: { toAccountId: checking.id, confirmCount: preview.json().totalAffected },
    })
    expect(await legsOf([payment])).toEqual({})
  })

  it('deletes every item with a leg on a deleted account, whole, and leaves the rest alone', async () => {
    const a = await makeAccount(user, { name: 'RecurDeleteA' })
    const b = await makeAccount(user, { name: 'RecurDeleteB' })
    const split = await newRecurringWithLegs('income', [[a.id, '300.00'], [b.id, '1200.00']])
    const bill = await newRecurringWithLegs('bill', [[a.id, '-45.00']])
    const untouched = await newRecurringWithLegs('bill', [[b.id, '-10.00']])

    const usage = await usageOf(a.id)
    expect(usage.by).toEqual([{ table: 'core.recurring_item_legs', count: 2 }])

    const res = await h.app.inject({
      method: 'POST', url: `/api/v1/accounts/${a.id}/delete-with-history`, headers: auth(user),
      payload: { confirmCount: usage.total },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().deletedRecurringItems).toBe(2)

    const legs = await legsOf([split, bill, untouched])
    // The split paycheck goes entirely, including its leg on B.
    expect(legs[split]).toBeUndefined()
    expect(legs[bill]).toBeUndefined()
    expect(legs[untouched]).toEqual({ [b.id]: '-10.0000' })
  })
})
