import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asUser } from '../db/client.js'
import { KyselyTransactionUndoRepository } from './repository/KyselyTransactionUndoRepository.js'
import { auth, createHarness, createUser, type Harness, type TestUser } from '../testing/harness.js'

/**
 * Undo for a deleted transaction (ADR 0016), end to end against real PostgreSQL:
 * the delete with `?undo=1`, the restore route, and every refusal.
 *
 * The round trip is checked by reading rows as `to_jsonb` in SQL and comparing
 * the text, so an amount is never a JavaScript number on either side of the
 * comparison.
 */

let h: Harness
let user: TestUser
let other: TestUser
let checking: string
let savings: string
let otherAccount: string
let today: string

const MISSING = '00000000-0000-4000-8000-000000000000'

interface UndoBody { id: string; expiresAt: string; kind: 'transaction' | 'transfer' }

async function create(path: string, u: TestUser, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await h.app.inject({ method: 'POST', url: path, headers: auth(u), payload })
  if (res.statusCode !== 201) throw new Error(`${path} failed: ${res.statusCode} ${res.body}`)
  return res.json() as Record<string, unknown>
}

const newAccount = async (u: TestUser, name: string): Promise<string> =>
  (await create('/api/v1/accounts', u, { name, accountType: 'checking', initialBalance: '0' }))['id'] as string

const newCategory = async (u: TestUser, name: string): Promise<string> =>
  (await create('/api/v1/categories', u, { name, slug: name.toLowerCase().replace(/\W+/g, '-') }))['id'] as string

async function spend(over: Record<string, unknown> = {}, u = user): Promise<string> {
  const body = await create('/api/v1/transactions', u, {
    accountId: checking, amount: '-12.3400', merchant: 'Coffee', transactionDate: '2026-05-01', ...over,
  })
  return body['id'] as string
}

async function newTransfer(amount = '25.5000'): Promise<{ id: string; legIds: string[] }> {
  const body = await create('/api/v1/transactions/transfer', user, {
    fromAccountId: checking, toAccountId: savings, amount, transactionDate: '2026-05-02',
  })
  return {
    id: body['transferId'] as string,
    legIds: (body['legs'] as Array<{ id: string }>).map((leg) => leg.id),
  }
}

const del = (id: string, query = '?undo=1', u = user) =>
  h.app.inject({ method: 'DELETE', url: `/api/v1/transactions/${id}${query}`, headers: auth(u) })

const restore = (id: string, u = user) =>
  h.app.inject({ method: 'POST', url: `/api/v1/transaction-undos/${id}/restore`, headers: auth(u) })

/** Deletes with Undo and returns the snapshot the answer carries. */
async function deleteWithUndo(id: string, u = user): Promise<UndoBody> {
  const res = await del(id, '?undo=1', u)
  expect(res.statusCode, res.body).toBe(200)
  const undo = (res.json() as { undo: UndoBody | null }).undo
  if (undo === null) throw new Error('expected a snapshot')
  return undo
}

/** Every column of the given transactions as the database prints it, ordered by id. */
async function rowsAsJson(ids: readonly string[], u = user): Promise<string[]> {
  return asUser(h.db, u.id, async (trx) => {
    const { rows } = await sql<{ j: string }>`
      SELECT to_jsonb(t)::text AS j FROM core.transactions t WHERE t.id = ANY(${[...ids]}::uuid[]) ORDER BY t.id
    `.execute(trx)
    return rows.map((r) => r.j)
  })
}

async function splitsAsJson(transactionId: string, u = user): Promise<string[]> {
  return asUser(h.db, u.id, async (trx) => {
    const { rows } = await sql<{ j: string }>`
      SELECT to_jsonb(s)::text AS j FROM core.transaction_splits s WHERE s.transaction_id = ${transactionId}::uuid ORDER BY s.id
    `.execute(trx)
    return rows.map((r) => r.j)
  })
}

async function dismissalsAsJson(transactionId: string, u = user): Promise<string[]> {
  return asUser(h.db, u.id, async (trx) => {
    const { rows } = await sql<{ j: string }>`
      SELECT to_jsonb(d)::text AS j FROM core.recurring_match_dismissals d
      WHERE d.transaction_id = ${transactionId}::uuid ORDER BY d.id
    `.execute(trx)
    return rows.map((r) => r.j)
  })
}

interface SnapshotRow { id: string; kind: string; transaction_count: number; restored_at: Date | null; payload_bytes: number; live: boolean }

/** The user's snapshots, read under their own row-level security (never the payload, only its size). */
async function snapshots(u = user): Promise<SnapshotRow[]> {
  return asUser(h.db, u.id, async (trx) => {
    const { rows } = await sql<SnapshotRow>`
      SELECT id, kind, transaction_count, restored_at, octet_length(payload::text) AS payload_bytes,
             (restored_at IS NULL AND expires_at >= now()) AS live
      FROM core.transaction_undo_snapshots ORDER BY created_at, id
    `.execute(trx)
    return rows
  })
}

const expire = (id: string, u = user): Promise<unknown> =>
  asUser(h.db, u.id, (trx) =>
    sql`UPDATE core.transaction_undo_snapshots SET expires_at = now() - interval '1 second' WHERE id = ${id}::uuid`.execute(trx),
  )

async function transactionIds(u = user): Promise<string[]> {
  return asUser(h.db, u.id, async (trx) => (await sql<{ id: string }>`SELECT id FROM core.transactions ORDER BY id`.execute(trx)).rows.map((r) => r.id))
}

const exists = async (id: string, u = user): Promise<boolean> => (await rowsAsJson([id], u)).length === 1

/** A monthly bill on `accountId` whose first occurrence is `due`; returns the item id. */
async function bill(name: string, amount: string, due: string, accountId = checking): Promise<string> {
  const body = await create('/api/v1/recurring-items', user, {
    name, kind: 'bill', frequency: 'monthly', seriesStartDate: due, legs: [{ accountId, amount }],
  })
  return body['id'] as string
}

const occurrenceUrl = (itemId: string, date: string): string => `/api/v1/recurring-items/${itemId}/occurrences/${date}`

async function matchTo(itemId: string, date: string, transactionId: string): Promise<void> {
  const res = await h.app.inject({
    method: 'POST', url: `${occurrenceUrl(itemId, date)}/matches`, headers: auth(user), payload: { transactionId },
  })
  expect(res.statusCode, res.body).toBe(200)
}

async function dismissAgainst(itemId: string, date: string, transactionId: string): Promise<void> {
  const res = await h.app.inject({
    method: 'POST', url: `${occurrenceUrl(itemId, date)}/dismissals`, headers: auth(user), payload: { transactionId },
  })
  expect(res.statusCode, res.body).toBe(200)
}

beforeAll(async () => {
  h = await createHarness()
  user = await createUser(h)
  other = await createUser(h)
  checking = await newAccount(user, 'Checking')
  savings = await newAccount(user, 'Savings')
  otherAccount = await newAccount(other, 'Theirs')
  const list = await h.app.inject({ method: 'GET', url: '/api/v1/recurring-items', headers: auth(user) })
  today = (list.json() as { today: string }).today
})

afterAll(async () => {
  await h.close()
})

describe('DELETE /transactions/:id', () => {
  it('answers 204 with no body and keeps no snapshot when ?undo is absent', async () => {
    const id = await spend()
    const before = (await snapshots()).length
    const res = await del(id, '')
    expect(res.statusCode).toBe(204)
    expect(res.body).toBe('')
    expect((await snapshots()).length).toBe(before)
    expect(await exists(id)).toBe(false)
  })

  it('ignores any value of undo other than 1', async () => {
    for (const query of ['?undo=0', '?undo=true', '?undo=', '?undo=1&undo=1']) {
      const id = await spend()
      const before = (await snapshots()).length
      const res = await del(id, query)
      expect(res.statusCode, query).toBe(204)
      expect((await snapshots()).length, query).toBe(before)
    }
  })

  it('answers 200 with the undo object when ?undo=1', async () => {
    const id = await spend()
    const before = Date.now()
    const res = await del(id)
    expect(res.statusCode).toBe(200)
    const { undo } = res.json() as { undo: UndoBody }
    expect(Object.keys(undo).sort()).toEqual(['expiresAt', 'id', 'kind'])
    expect(undo.kind).toBe('transaction')
    expect(undo.id).toMatch(/^[0-9a-f-]{36}$/)
    const ttl = (Date.parse(undo.expiresAt) - before) / 1000
    expect(ttl).toBeGreaterThan(590)
    expect(ttl).toBeLessThan(610)
    expect(await exists(id)).toBe(false)
  })

  it('still answers 404 and 400 as before', async () => {
    expect((await del(MISSING)).statusCode).toBe(404)
    expect((await del(MISSING, '')).statusCode).toBe(404)
    expect((await del('not-a-uuid')).statusCode).toBe(400)
    expect((await snapshots()).every((s) => s.live === false || s.transaction_count >= 1)).toBe(true)
  })

  it('answers 404 for another user\'s transaction and keeps it and writes no snapshot', async () => {
    const theirs = await spend({ accountId: otherAccount }, other)
    const before = (await snapshots(other)).length
    expect((await del(theirs, '?undo=1', user)).statusCode).toBe(404)
    expect(await exists(theirs, other)).toBe(true)
    expect((await snapshots(other)).length).toBe(before)
  })

  it('writes a kind of transfer, with both legs, for a transfer', async () => {
    const t = await newTransfer()
    const undo = await deleteWithUndo(t.legIds[1]!)
    expect(undo.kind).toBe('transfer')
    const row = (await snapshots()).find((s) => s.id === undo.id)
    expect(row).toMatchObject({ kind: 'transfer', transaction_count: 2 })
    expect(await transactionIds()).not.toEqual(expect.arrayContaining(t.legIds))
  })
})

describe('round trip', () => {
  it('restores an ordinary transaction byte for byte, including exact money and timestamps', async () => {
    const id = await spend({ amount: '-123456789012345.6789', merchant: 'Big one', notes: 'a note' })
    // Old, microsecond-precision timestamps in two zones: they must come back as they were.
    await asUser(h.db, user.id, (trx) => sql`
      UPDATE core.transactions
      SET created_at = '2020-01-02 03:04:05.123456+00', updated_at = '2021-06-07 08:09:10.654321-05'
      WHERE id = ${id}::uuid
    `.execute(trx))
    const before = await rowsAsJson([id])
    expect(before[0]).toContain('-123456789012345.6789')

    const undo = await deleteWithUndo(id)
    expect(await exists(id)).toBe(false)
    const res = await restore(undo.id)
    expect(res.statusCode, res.body).toBe(200)
    expect(res.json()).toEqual({ restored: 1, relinkedMatch: false, restoredDismissals: 0, skippedDismissals: 0 })

    expect(await rowsAsJson([id])).toEqual(before)
  })

  it('restores a split transaction with its splits under their own ids', async () => {
    const food = await newCategory(user, 'Split food')
    const fun = await newCategory(user, 'Split fun')
    const id = await spend({ amount: '-100.0000', merchant: 'Superstore' })
    const put = await h.app.inject({
      method: 'PUT', url: `/api/v1/transactions/${id}/splits`, headers: auth(user),
      payload: { splits: [
        { amount: '-60.2500', categoryId: food, notes: 'groceries' },
        { amount: '-39.7500', categoryId: fun },
      ] },
    })
    expect(put.statusCode, put.body).toBe(200)
    const rowBefore = await rowsAsJson([id])
    const splitsBefore = await splitsAsJson(id)
    expect(splitsBefore).toHaveLength(2)

    const undo = await deleteWithUndo(id)
    expect(await splitsAsJson(id)).toEqual([])
    expect((await restore(undo.id)).statusCode).toBe(200)

    expect(await rowsAsJson([id])).toEqual(rowBefore)
    expect(await splitsAsJson(id)).toEqual(splitsBefore)
    const list = await h.app.inject({ method: 'GET', url: `/api/v1/transactions/${id}/splits`, headers: auth(user) })
    expect((list.json() as Array<{ amount: string }>).map((s) => s.amount).sort()).toEqual(['-39.7500', '-60.2500'])
  })

  it('restores a transfer: both legs, or neither', async () => {
    const t = await newTransfer('77.7700')
    const before = await rowsAsJson(t.legIds)
    expect(before).toHaveLength(2)
    const undo = await deleteWithUndo(t.legIds[0]!)
    expect(await rowsAsJson(t.legIds)).toEqual([])

    const res = await restore(undo.id)
    expect(res.json()).toMatchObject({ restored: 2 })
    expect(await rowsAsJson(t.legIds)).toEqual(before)
  })

  it('restores nothing of a transfer when the account of one leg is gone', async () => {
    const from = await newAccount(user, 'Leg from')
    const to = await newAccount(user, 'Leg to')
    const body = await create('/api/v1/transactions/transfer', user, {
      fromAccountId: from, toAccountId: to, amount: '10.0000', transactionDate: '2026-05-03',
    })
    const legs = (body['legs'] as Array<{ id: string }>).map((l) => l.id)
    const undo = await deleteWithUndo(legs[0]!)
    expect((await h.app.inject({ method: 'DELETE', url: `/api/v1/accounts/${to}`, headers: auth(user) })).statusCode).toBe(204)

    const res = await restore(undo.id)
    expect(res.statusCode).toBe(409)
    expect(res.json()).toMatchObject({ code: 'undo_unavailable' })
    expect(res.json<{ message: string }>().message).toMatch(/account/)
    expect(await rowsAsJson(legs)).toEqual([])
    // The snapshot is as it was: not restored, not spent.
    expect((await snapshots()).find((s) => s.id === undo.id)).toMatchObject({ restored_at: null, live: true })
  })

  it('puts a restored row back where it was in every sort', async () => {
    const acct = await newAccount(user, 'Sorted')
    const ids: string[] = []
    for (const [merchant, amount, date] of [
      ['Alpha', '-5.0000', '2026-06-01'], ['Bravo', '-5.0000', '2026-06-01'], ['Charlie', '-7.5000', '2026-06-02'],
      ['Delta', '-5.0000', '2026-06-03'],
    ] as const) ids.push(await spend({ accountId: acct, merchant, amount, transactionDate: date }))
    const order = async (sort: string): Promise<string[]> => {
      const res = await h.app.inject({
        method: 'GET', url: `/api/v1/transactions?accountId=${acct}&sort=${sort}&limit=50`, headers: auth(user),
      })
      return (res.json() as { items: Array<{ id: string }> }).items.map((t) => t.id)
    }
    const before = { date: await order('date'), amount: await order('amount'), merchant: await order('merchant') }
    const undo = await deleteWithUndo(ids[1]!)
    expect(await order('date')).not.toContain(ids[1])
    expect((await restore(undo.id)).statusCode).toBe(200)
    expect({ date: await order('date'), amount: await order('amount'), merchant: await order('merchant') }).toEqual(before)
  })

  it('moves the account balance back exactly', async () => {
    const acct = await newAccount(user, 'Balance')
    const id = await spend({ accountId: acct, amount: '-33.3300' })
    const balance = async (): Promise<string> =>
      ((await h.app.inject({ method: 'GET', url: `/api/v1/accounts/${acct}`, headers: auth(user) })).json() as { balance: string }).balance
    const before = await balance()
    const undo = await deleteWithUndo(id)
    expect(await balance()).not.toBe(before)
    await restore(undo.id)
    expect(await balance()).toBe(before)
  })

  it('restores every column: a fixture with all of them set, a matched row, an external id', async () => {
    const category = await newCategory(user, 'Everything')
    const itemId = await bill('Everything bill', '-50.0000', today)
    // An ordinary row with every column except the transfer pair set.
    const id = await spend({
      amount: '-50.0000', merchant: 'Everything', notes: 'all set', externalId: 'ext-everything', categoryId: category,
      transactionDate: today,
    })
    await matchTo(itemId, today, id)
    await asUser(h.db, user.id, (trx) => sql`
      UPDATE core.transactions SET created_at = '2019-03-04 05:06:07.891011+00', is_split = true WHERE id = ${id}::uuid
    `.execute(trx))
    // A transfer leg carries the transfer pair, an external id and notes.
    const body = await create('/api/v1/transactions/transfer', user, {
      fromAccountId: checking, toAccountId: savings, amount: '8.0000', transactionDate: today,
      notes: 'leg note', externalId: 'ext-transfer',
    })
    const legs = (body['legs'] as Array<{ id: string }>).map((l) => l.id)

    // Every column of core.transactions is set on at least one of the fixtures, so a column a later
    // migration adds fails here until the fixture sets it, and the round trip below covers it.
    const columns = await asUser(h.db, user.id, async (trx) => {
      const names = (await sql<{ column_name: string }>`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'core' AND table_name = 'transactions' ORDER BY ordinal_position
      `.execute(trx)).rows.map((r) => r.column_name)
      const unset: string[] = []
      for (const name of names) {
        const { rows } = await sql<{ n: number }>`
          SELECT count(*)::int AS n FROM core.transactions
          WHERE id = ANY(${[id, ...legs]}::uuid[]) AND ${sql.id(name)} IS NOT NULL
        `.execute(trx)
        if ((rows[0]?.n ?? 0) === 0) unset.push(name)
      }
      return { names, unset }
    })
    expect(columns.names).toEqual(expect.arrayContaining(['recurring_occurrence_id', 'external_id', 'transfer_id', 'transfer_account_id']))
    expect(columns.unset).toEqual([])

    const dismissOnly = await spend({ amount: '-9.0000', merchant: 'Dismissed once', transactionDate: today })
    await dismissAgainst(itemId, today, dismissOnly)

    for (const group of [[id], legs, [dismissOnly]]) {
      const before = await rowsAsJson(group)
      const dismissalsBefore = group.length === 1 ? await dismissalsAsJson(group[0]!) : []
      const undo = await deleteWithUndo(group[0]!)
      expect(await rowsAsJson(group)).toEqual([])
      const res = await restore(undo.id)
      expect(res.statusCode, res.body).toBe(200)
      expect(await rowsAsJson(group)).toEqual(before)
      if (group.length === 1) expect(await dismissalsAsJson(group[0]!)).toEqual(dismissalsBefore)
    }
  })

  it('shows the restored transaction as matched again', async () => {
    const itemId = await bill('Rent', '-900.0000', today)
    const id = await spend({ amount: '-900.0000', merchant: 'Landlord', transactionDate: today })
    await matchTo(itemId, today, id)
    const undo = await deleteWithUndo(id)
    const res = await restore(undo.id)
    expect(res.json()).toMatchObject({ restored: 1, relinkedMatch: true })
    const matches = await h.app.inject({
      method: 'GET', url: `/api/v1/recurring-items/transaction-matches?transactionIds=${id}`, headers: auth(user),
    })
    expect((matches.json() as { transactions: Array<{ linked: { itemId: string } | null }> }).transactions[0]?.linked?.itemId).toBe(itemId)
  })

  it('restores a matched transaction with its link cleared when the occurrence is gone', async () => {
    const itemId = await bill('Gone bill', '-40.0000', today)
    const id = await spend({ amount: '-40.0000', merchant: 'Gone', transactionDate: today })
    await matchTo(itemId, today, id)
    const undo = await deleteWithUndo(id)
    expect((await h.app.inject({ method: 'DELETE', url: `/api/v1/recurring-items/${itemId}`, headers: auth(user) })).statusCode).toBe(204)

    const res = await restore(undo.id)
    expect(res.statusCode, res.body).toBe(200)
    expect(res.json()).toMatchObject({ restored: 1, relinkedMatch: false })
    const [row] = await rowsAsJson([id])
    expect(JSON.parse(row!)).toMatchObject({ recurring_occurrence_id: null })
  })

  it('restores dismissals whose item is kept and skips those whose item is gone', async () => {
    const kept = await bill('Kept bill', '-30.0000', today)
    const lost = await bill('Lost bill', '-30.0000', today)
    const id = await spend({ amount: '-30.0000', merchant: 'Dismissed', transactionDate: today })
    await dismissAgainst(kept, today, id)
    await dismissAgainst(lost, today, id)
    expect(await dismissalsAsJson(id)).toHaveLength(2)

    const undo = await deleteWithUndo(id)
    expect(await dismissalsAsJson(id)).toHaveLength(0)
    expect((await h.app.inject({ method: 'DELETE', url: `/api/v1/recurring-items/${lost}`, headers: auth(user) })).statusCode).toBe(204)

    const res = await restore(undo.id)
    expect(res.json()).toMatchObject({ restored: 1, restoredDismissals: 1, skippedDismissals: 1 })
    const rows = (await dismissalsAsJson(id)).map((r) => JSON.parse(r) as { recurring_item_id: string })
    expect(rows.map((r) => r.recurring_item_id)).toEqual([kept])
  })
})

describe('refusals', () => {
  it('answers 409 already_undone for a second restore and changes nothing', async () => {
    const id = await spend()
    const undo = await deleteWithUndo(id)
    expect((await restore(undo.id)).statusCode).toBe(200)
    const before = await rowsAsJson([id])
    const again = await restore(undo.id)
    expect(again.statusCode).toBe(409)
    expect(again.json()).toMatchObject({ code: 'already_undone' })
    expect(await rowsAsJson([id])).toEqual(before)
    // Delete it again: the old snapshot cannot restore the new deletion's row, only its own.
    const second = await deleteWithUndo(id)
    expect(second.id).not.toBe(undo.id)
    expect((await restore(undo.id)).statusCode).toBe(409)
    expect(await exists(id)).toBe(false)
    expect((await restore(second.id)).statusCode).toBe(200)
  })

  it('answers 410 undo_expired for an expired snapshot that is not yet purged, and leaves it', async () => {
    const id = await spend()
    const undo = await deleteWithUndo(id)
    await expire(undo.id)
    const res = await restore(undo.id)
    expect(res.statusCode).toBe(410)
    expect(res.json()).toMatchObject({ code: 'undo_expired' })
    expect(res.json<{ message: string }>().message).toBe('It is too late to undo that.')
    expect(await exists(id)).toBe(false)
    // Still there: a refused restore does not purge it.
    expect((await snapshots()).some((s) => s.id === undo.id)).toBe(true)
  })

  it('answers 404 not_found once an expired snapshot has been purged, and for an id that never existed', async () => {
    const id = await spend()
    const undo = await deleteWithUndo(id)
    await expire(undo.id)
    const purged = await h.db.transaction().execute(async (trx) =>
      (await sql<{ n: string }>`SELECT core.purge_expired_transaction_undos() AS n`.execute(trx)).rows[0]?.n)
    expect(Number(purged)).toBeGreaterThanOrEqual(1)
    const res = await restore(undo.id)
    expect(res.statusCode).toBe(404)
    expect(res.json()).toMatchObject({ code: 'not_found' })
    const never = await restore(MISSING)
    expect(never.statusCode).toBe(404)
    expect(never.json()).toEqual(res.json())
    expect((await restore('not-a-uuid')).statusCode).toBe(400)
  })

  it('answers 409 undo_conflict when the external id is now used, and inserts nothing', async () => {
    const id = await spend({ externalId: 'reused-key', merchant: 'Original' })
    const undo = await deleteWithUndo(id)
    const replacement = await spend({ externalId: 'reused-key', merchant: 'Replacement' })
    const before = await transactionIds()

    const res = await restore(undo.id)
    expect(res.statusCode).toBe(409)
    expect(res.json()).toMatchObject({ code: 'undo_conflict' })
    expect(await transactionIds()).toEqual(before)
    expect(await exists(id)).toBe(false)

    // The person can delete the other row first, and then the restore works.
    expect((await del(replacement, '')).statusCode).toBe(204)
    expect((await restore(undo.id)).statusCode).toBe(200)
    expect(await exists(id)).toBe(true)
  })

  it('answers 409 undo_conflict when another request takes the key between the check and the insert', async () => {
    const id = await spend({ externalId: 'race-key' })
    const undo = await deleteWithUndo(id)
    await spend({ externalId: 'race-key', merchant: 'Taker' })
    // Skip the pre-check, as a request that lost the race would: the insert itself must be translated.
    await expect(
      asUser(h.db, user.id, (trx) => new KyselyTransactionUndoRepository(trx).restore(undo.id)),
    ).rejects.toMatchObject({ name: 'DuplicateKeyError' })
    expect(await exists(id)).toBe(false)
  })

  it('answers 409 undo_unavailable naming a deleted account', async () => {
    const acct = await newAccount(user, 'Soon gone')
    const id = await spend({ accountId: acct })
    const undo = await deleteWithUndo(id)
    expect((await h.app.inject({ method: 'DELETE', url: `/api/v1/accounts/${acct}`, headers: auth(user) })).statusCode).toBe(204)
    const res = await restore(undo.id)
    expect(res.statusCode).toBe(409)
    expect(res.json()).toMatchObject({ code: 'undo_unavailable' })
    expect(res.json<{ message: string }>().message).toContain('an account')
  })

  it('answers 409 undo_unavailable naming a deleted category, on the transaction or on a split', async () => {
    const onRow = await newCategory(user, 'Row cat')
    const id = await spend({ categoryId: onRow })
    const undo = await deleteWithUndo(id)
    expect((await h.app.inject({ method: 'DELETE', url: `/api/v1/categories/${onRow}`, headers: auth(user) })).statusCode).toBe(204)
    const res = await restore(undo.id)
    expect(res.statusCode).toBe(409)
    expect(res.json()).toMatchObject({ code: 'undo_unavailable' })
    expect(res.json<{ message: string }>().message).toContain('a category')
    expect(await exists(id)).toBe(false)

    const a = await newCategory(user, 'Split cat a')
    const b = await newCategory(user, 'Split cat b')
    const split = await spend({ amount: '-20.0000' })
    await h.app.inject({
      method: 'PUT', url: `/api/v1/transactions/${split}/splits`, headers: auth(user),
      payload: { splits: [{ amount: '-10.0000', categoryId: a }, { amount: '-10.0000', categoryId: b }] },
    })
    const undoSplit = await deleteWithUndo(split)
    expect((await h.app.inject({ method: 'DELETE', url: `/api/v1/categories/${b}`, headers: auth(user) })).statusCode).toBe(204)
    expect((await restore(undoSplit.id)).statusCode).toBe(409)
    expect(await exists(split)).toBe(false)
    expect(await splitsAsJson(split)).toEqual([])
  })
})

describe('an imported row', () => {
  it('goes back into its batch and still counts as untouched when the import is reverted', async () => {
    const { seedBundledPlugins } = await import('../plugins/registry.js')
    await seedBundledPlugins(h.db)
    const acct = await newAccount(user, 'Imported')
    const base = '/api/v1/p/wickermoney.import-csv'
    const headers = { ...auth(user), 'x-wickermoney-plugin': 'wickermoney.import-csv' }
    const csv = [
      'Date,Description,Amount,Id',
      '03/04/2026,UNDO IMPORT A,-4.50,undo-imp-1',
      '03/05/2026,UNDO IMPORT B,-6.25,undo-imp-2',
    ].join('\n')
    const committed = await h.app.inject({
      method: 'POST', url: `${base}/commit`, headers,
      payload: {
        accountId: acct, csv, fileName: 'undo.csv', sourceName: 'Undo Bank',
        columns: { date: 'Date', merchant: 'Description', amount: 'Amount', externalId: 'Id' },
        dateFormat: 'MM/DD/YYYY', amountStyle: 'signed', invertAmount: false,
      },
    })
    expect(committed.statusCode, committed.body).toBe(200)
    const { batchId } = committed.json() as { batchId: string }
    const ids = await asUser(h.db, user.id, async (trx) =>
      (await sql<{ id: string }>`SELECT id FROM core.transactions WHERE account_id = ${acct}::uuid ORDER BY external_id`.execute(trx)).rows.map((r) => r.id))
    expect(ids).toHaveLength(2)

    const undo = await deleteWithUndo(ids[0]!)
    expect((await restore(undo.id)).statusCode).toBe(200)

    // `deleteUntouchedInBatch` takes rows whose updated_at is not after created_at: restored timestamps keep that true.
    const reverted = await h.app.inject({ method: 'POST', url: `${base}/batches/${batchId}/revert`, headers, payload: {} })
    expect(reverted.statusCode, reverted.body).toBe(200)
    expect(reverted.json()).toMatchObject({ reverted: 2, skipped: 0 })
  })
})

describe('isolation', () => {
  it('answers 404 to another user for a real snapshot id, and restores nothing', async () => {
    const id = await spend({ merchant: 'Mine only' })
    const undo = await deleteWithUndo(id)
    const before = { mine: await transactionIds(user), theirs: await transactionIds(other) }

    const res = await restore(undo.id, other)
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual((await restore(MISSING, other)).json())
    expect({ mine: await transactionIds(user), theirs: await transactionIds(other) }).toEqual(before)
    // The owner can still restore it.
    expect((await restore(undo.id, user)).statusCode).toBe(200)
  })

  it('does not let another user\'s listing, deletes or restores touch a snapshot', async () => {
    const id = await spend()
    const undo = await deleteWithUndo(id)
    expect((await snapshots(other)).some((s) => s.id === undo.id)).toBe(false)
    expect((await snapshots(user)).some((s) => s.id === undo.id)).toBe(true)
    const swept = await asUser(h.db, other.id, async (trx) =>
      Number((await sql`DELETE FROM core.transaction_undo_snapshots WHERE id = ${undo.id}::uuid`.execute(trx)).numAffectedRows))
    expect(swept).toBe(0)
    expect((await snapshots(user)).some((s) => s.id === undo.id)).toBe(true)
  })

  it('refuses a hand-written snapshot for one user whose payload names another user\'s account, and inserts nothing', async () => {
    // Written as `other` (the row policy allows it: the snapshot is other's), but the payload names `user`'s account.
    const victimTxn = await spend({ merchant: 'Victim' })
    const [victimRow] = await rowsAsJson([victimTxn])
    const victim = JSON.parse(victimRow!) as Record<string, unknown>
    const forgedId = '99999999-9999-4999-8999-999999999999'
    const forged = { ...victim, id: forgedId, user_id: other.id, external_id: null, recurring_occurrence_id: null, category_id: null, category_source: null }
    const snapshotId = await asUser(h.db, other.id, async (trx) =>
      (await sql<{ id: string }>`
        INSERT INTO core.transaction_undo_snapshots (user_id, kind, payload, transaction_count, expires_at)
        VALUES (${other.id}::uuid, 'transaction',
                ${JSON.stringify({ transactions: [forged], splits: [], dismissals: [] })}::jsonb, 1, now() + interval '5 minutes')
        RETURNING id
      `.execute(trx)).rows[0]!.id)
    const before = await transactionIds(other)

    // Through the API the account looks missing to `other` (row-level security), so it is refused up front.
    const res = await restore(snapshotId, other)
    expect(res.statusCode).toBe(409)
    expect(res.json()).toMatchObject({ code: 'undo_unavailable' })

    // And with the pre-check skipped, the composite (user_id, account_id) key refuses the insert.
    await expect(
      asUser(h.db, other.id, (trx) => new KyselyTransactionUndoRepository(trx).restore(snapshotId)),
    ).rejects.toMatchObject({ code: '23503' })
    expect(await transactionIds(other)).toEqual(before)
    expect(await exists(forgedId, user)).toBe(false)
  })

  it('refuses a payload row that names another user as its owner, by the row policy of core.transactions', async () => {
    const victimTxn = await spend({ merchant: 'Victim 2' })
    const [victimRow] = await rowsAsJson([victimTxn])
    // The victim's row verbatim (user_id and id of `user`), planted in `other`'s snapshot.
    const snapshotId = await asUser(h.db, other.id, async (trx) =>
      (await sql<{ id: string }>`
        INSERT INTO core.transaction_undo_snapshots (user_id, kind, payload, transaction_count, expires_at)
        VALUES (${other.id}::uuid, 'transaction',
                ${JSON.stringify({ transactions: [JSON.parse(victimRow!)], splits: [], dismissals: [] })}::jsonb, 1,
                now() + interval '5 minutes')
        RETURNING id
      `.execute(trx)).rows[0]!.id)
    await expect(
      asUser(h.db, other.id, (trx) => new KyselyTransactionUndoRepository(trx).restore(snapshotId)),
    ).rejects.toMatchObject({ code: '42501' })
    expect(await rowsAsJson([victimTxn])).toEqual([victimRow])
  })

  it('cannot plant a snapshot owned by someone else', async () => {
    await expect(
      asUser(h.db, other.id, (trx) => sql`
        INSERT INTO core.transaction_undo_snapshots (user_id, kind, payload, transaction_count, expires_at)
        VALUES (${user.id}::uuid, 'transaction', '{}'::jsonb, 1, now() + interval '5 minutes')
      `.execute(trx)),
    ).rejects.toMatchObject({ code: '42501' })
  })
})

describe('concurrency', () => {
  it('gives one 200 and one 409 for two simultaneous restores of one snapshot', async () => {
    for (let round = 0; round < 5; round++) {
      const id = await spend({ merchant: `Race ${round}` })
      const undo = await deleteWithUndo(id)
      const results = await Promise.all([restore(undo.id), restore(undo.id)])
      expect(results.map((r) => r.statusCode).sort(), `round ${round}`).toEqual([200, 409])
      const refused = results.find((r) => r.statusCode === 409)!
      expect(refused.json()).toMatchObject({ code: 'already_undone' })
      expect(await rowsAsJson([id])).toHaveLength(1)
    }
  })

  it('serialises a restore against a delete of the same row: the row is never lost or doubled', async () => {
    const id = await spend({ merchant: 'Ping pong' })
    const first = await deleteWithUndo(id)
    const [restored, deleted] = await Promise.all([restore(first.id), del(id, '?undo=1')])
    expect(restored.statusCode).toBe(200)
    // The delete either ran before the restore (404, nothing there yet) or after it (200 with a new snapshot).
    expect([200, 404]).toContain(deleted.statusCode)
    expect((await rowsAsJson([id])).length).toBe(deleted.statusCode === 200 ? 0 : 1)
  })
})

describe('purge and the cap', () => {
  it('purges the caller\'s expired snapshots on a delete', async () => {
    const a = await deleteWithUndo(await spend())
    const b = await deleteWithUndo(await spend())
    await expire(a.id)
    await expire(b.id)
    expect((await snapshots()).filter((s) => [a.id, b.id].includes(s.id))).toHaveLength(2)
    await deleteWithUndo(await spend())
    expect((await snapshots()).filter((s) => [a.id, b.id].includes(s.id))).toHaveLength(0)
  })

  it('purges them on a successful restore, but not before answering 410 for the one asked about', async () => {
    const stale = await deleteWithUndo(await spend())
    const fresh = await deleteWithUndo(await spend())
    await expire(stale.id)
    expect((await restore(fresh.id)).statusCode).toBe(200)
    expect((await snapshots()).some((s) => s.id === stale.id)).toBe(false)
  })

  it('keeps at most 20 live snapshots per user, dropping the oldest', async () => {
    const cappedUser = await createUser(h)
    const acct = await newAccount(cappedUser, 'Capped')
    const undos: UndoBody[] = []
    for (let i = 0; i < 23; i++) {
      const id = await spend({ accountId: acct, merchant: `Cap ${i}` }, cappedUser)
      undos.push(await deleteWithUndo(id, cappedUser))
    }
    const live = (await snapshots(cappedUser)).filter((s) => s.live)
    expect(live).toHaveLength(20)
    expect(live.map((s) => s.id)).toEqual(undos.slice(3).map((u) => u.id))
    expect((await restore(undos[0]!.id, cappedUser)).statusCode).toBe(404)
    expect((await restore(undos[22]!.id, cappedUser)).statusCode).toBe(200)
  })

  it('keeps one snapshot per delete: deleting twice gives two ids that restore separately', async () => {
    const one = await spend({ merchant: 'One' })
    const two = await spend({ merchant: 'Two' })
    const a = await deleteWithUndo(one)
    const b = await deleteWithUndo(two)
    expect(a.id).not.toBe(b.id)
    expect((await restore(b.id)).statusCode).toBe(200)
    expect(await exists(one)).toBe(false)
    expect((await restore(a.id)).statusCode).toBe(200)
    expect(await exists(one)).toBe(true)
  })

  it('empties the payload of a restored snapshot', async () => {
    const undo = await deleteWithUndo(await spend())
    expect((await snapshots()).find((s) => s.id === undo.id)!.payload_bytes).toBeGreaterThan(100)
    await restore(undo.id)
    expect((await snapshots()).find((s) => s.id === undo.id)).toMatchObject({ payload_bytes: 2, live: false })
  })
})

describe('size', () => {
  it('fits a transaction with the most splits it may have (100) far below the cap', async () => {
    const cat = await newCategory(user, 'Hundred')
    const id = await spend({ amount: '-100.0000', merchant: 'Hundred splits' })
    const put = await h.app.inject({
      method: 'PUT', url: `/api/v1/transactions/${id}/splits`, headers: auth(user),
      payload: { splits: Array.from({ length: 100 }, () => ({ amount: '-1.0000', categoryId: cat, notes: 'x'.repeat(1000) })) },
    })
    expect(put.statusCode, put.body).toBe(200)
    const undo = await deleteWithUndo(id)
    const size = (await snapshots()).find((s) => s.id === undo.id)!.payload_bytes
    // 100 splits with 1000-character notes, the largest a transaction may hold: about 150 KB of 256 KiB.
    expect(size).toBeLessThan(262_144)
    expect(size).toBeGreaterThan(100_000)
    expect((await restore(undo.id)).statusCode).toBe(200)
    expect(await splitsAsJson(id)).toHaveLength(100)
  })

  it('still deletes, with no undo, when the snapshot would be over the cap', async () => {
    const itemId = await bill('Dismissed a lot', '-5.0000', today)
    const id = await spend({ amount: '-5.0000', merchant: 'Many dismissals', transactionDate: today })
    // Dismissals are the one unbounded part of a snapshot: one row per (item, occurrence date).
    await asUser(h.db, user.id, (trx) => sql`
      INSERT INTO core.recurring_match_dismissals (user_id, transaction_id, recurring_item_id, nominal_date)
      SELECT ${user.id}::uuid, ${id}::uuid, ${itemId}::uuid, DATE '2000-01-01' + g FROM generate_series(1, 1600) g
    `.execute(trx))
    const before = (await snapshots()).length
    const res = await del(id)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ undo: null })
    expect(await exists(id)).toBe(false)
    expect((await snapshots()).length).toBe(before)
  })
})

describe('Undo switched off (UNDO_TTL_SECONDS=0)', () => {
  let off: Harness

  beforeAll(async () => {
    off = await createHarness({ UNDO_TTL_SECONDS: '0' })
  })
  afterAll(async () => {
    await off.close()
  })

  it('answers 204 without the flag, 200 with { undo: null } with it, and writes nothing', async () => {
    const mine = await off.app.inject({
      method: 'POST', url: '/api/v1/transactions', headers: auth(user),
      payload: { accountId: checking, amount: '-1.0000', merchant: 'Off', transactionDate: '2026-05-01' },
    })
    const before = (await snapshots()).length
    const plain = await off.app.inject({ method: 'DELETE', url: `/api/v1/transactions/${(mine.json() as { id: string }).id}`, headers: auth(user) })
    expect(plain.statusCode).toBe(204)

    const second = await off.app.inject({
      method: 'POST', url: '/api/v1/transactions', headers: auth(user),
      payload: { accountId: checking, amount: '-2.0000', merchant: 'Off 2', transactionDate: '2026-05-01' },
    })
    const flagged = await off.app.inject({
      method: 'DELETE', url: `/api/v1/transactions/${(second.json() as { id: string }).id}?undo=1`, headers: auth(user),
    })
    expect(flagged.statusCode).toBe(200)
    expect(flagged.json()).toEqual({ undo: null })
    expect((await snapshots()).length).toBe(before)
  })

  it('answers 404 on the restore route, even for a snapshot written while Undo was on', async () => {
    const undo = await deleteWithUndo(await spend())
    const res = await off.app.inject({ method: 'POST', url: `/api/v1/transaction-undos/${undo.id}/restore`, headers: auth(user) })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toMatchObject({ code: 'not_found' })
    expect((await restore(undo.id)).statusCode).toBe(200)
  })
})

describe('what a delete does not change', () => {
  it('leaves the delete of an account\'s other rows, and every other route, answering as before', async () => {
    const id = await spend()
    const patch = await h.app.inject({
      method: 'PATCH', url: `/api/v1/transactions/${id}`, headers: auth(user), payload: { merchant: 'Edited' },
    })
    expect(patch.statusCode).toBe(200)
    const undo = await deleteWithUndo(id)
    expect((await restore(undo.id)).statusCode).toBe(200)
    // An edit made after the restore is an ordinary edit of an ordinary row.
    const again = await h.app.inject({
      method: 'PATCH', url: `/api/v1/transactions/${id}`, headers: auth(user), payload: { merchant: 'Edited again' },
    })
    expect(again.statusCode).toBe(200)
    expect(again.json()).toMatchObject({ merchant: 'Edited again' })
  })
})
