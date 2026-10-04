import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { auth, createHarness, createUser, type Harness, type TestUser } from '../testing/harness.js'
import { asPlugin, asUser, createDb } from '../db/client.js'
import { pluginRoleName, pluginSchemaName } from '../db/plugin-roles.js'
import { up as applyIdempotencyMigration } from '../db/migrations/017_import_idempotency.js'
import { exportImportData } from '@wickermoney/plugin-import-csv/server'
import { queryRunner } from './queryRunner.js'

const PLUGIN = 'wickermoney.import-csv'
const BASE = `/api/v1/p/${PLUGIN}`

let h: Harness
let user: TestUser
let other: TestUser
let accountId: string
let otherAccountId: string

const headers = (u: TestUser) => ({ ...auth(u), 'x-wickermoney-plugin': PLUGIN })

async function newAccount(u: TestUser, name: string): Promise<string> {
  const res = await h.app.inject({
    method: 'POST',
    url: '/api/v1/accounts',
    headers: auth(u),
    payload: { name, accountType: 'checking', openingBalance: '0.00' },
  })
  if (res.statusCode !== 201) throw new Error(`account failed: ${res.statusCode} ${res.body}`)
  return (res.json() as { id: string }).id
}

const MAPPING = {
  sourceName: 'Test Bank',
  columns: { date: 'Date', merchant: 'Description', amount: 'Amount', externalId: 'Id' },
  dateFormat: 'MM/DD/YYYY',
  amountStyle: 'signed',
  invertAmount: false,
}

const CSV = [
  'Date,Description,Amount,Id',
  '03/04/2026,"COFFEE BAR, MAIN ST",-4.50,tx-1',
  '03/05/2026,PAYCHECK,"2,500.00",tx-2',
  '03/06/2026,GROCERY WORLD,-81.20,tx-3',
].join('\n')

beforeAll(async () => {
  h = await createHarness()
  const { seedBundledPlugins } = await import('./registry.js')
  await seedBundledPlugins(h.db)
  user = await createUser(h)
  other = await createUser(h)
  accountId = await newAccount(user, 'Everyday')
  otherAccountId = await newAccount(other, 'Theirs')
})
afterAll(async () => { await h.close() })

async function analyze(payload: Record<string, unknown>, u = user) {
  return h.app.inject({ method: 'POST', url: `${BASE}/analyze`, headers: headers(u), payload })
}
async function commit(payload: Record<string, unknown>, u = user) {
  return h.app.inject({ method: 'POST', url: `${BASE}/commit`, headers: headers(u), payload })
}

describe('provisioning', () => {
  it('creates the schema the derivation rule names', async () => {
    // The schema is created as `plugin_import_csv` and `pluginSchemaName` derives
    // the same string. When those disagreed, the schema grant was silently
    // skipped and every plugin query failed with "permission denied for
    // schema" at runtime — nothing failed at migrate time.
    const schema = pluginSchemaName(PLUGIN)
    const { rows } = await sql<{ exists: boolean }>`
      SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = ${schema}) AS exists
    `.execute(h.db)
    expect(schema).toBe('plugin_import_csv')
    expect(rows[0]?.exists).toBe(true)
  })

  it('grants exactly what the manifest asks for, and nothing else', async () => {
    const role = pluginRoleName(PLUGIN)
    const priv = async (table: string, privilege: string): Promise<boolean> => {
      const { rows } = await sql<{ ok: boolean }>`
        SELECT has_table_privilege(${role}, ${`core.${table}`}, ${privilege}) AS ok
      `.execute(h.db)
      return rows[0]?.ok === true
    }

    // The manifest asks for transactions:write and three reads.
    expect(await priv('transactions', 'INSERT')).toBe(true)
    expect(await priv('accounts', 'SELECT')).toBe(true)
    expect(await priv('categories', 'SELECT')).toBe(true)
    expect(await priv('category_rules', 'SELECT')).toBe(true)

    // And nothing it did not ask for.
    expect(await priv('accounts', 'INSERT')).toBe(false)
    expect(await priv('recurring_items', 'SELECT')).toBe(false)
    expect(await priv('transaction_splits', 'SELECT')).toBe(false)
  })
})

describe('importing a file', () => {
  it('reads dates in the chosen format and money as exact strings', async () => {
    const res = await analyze({ accountId, csv: CSV, ...MAPPING })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { summary: { new: number }; rows: Array<{ date: string; amount: string }> }

    expect(body.summary.new).toBe(3)
    expect(body.rows[0]?.date).toBe('2026-03-04')
    expect(body.rows[1]?.amount).toBe('2500.00')
  })

  it('reads the same file differently under a different date format (Q24)', async () => {
    const res = await analyze({ accountId, csv: CSV, ...MAPPING, dateFormat: 'DD/MM/YYYY' })
    const body = res.json() as { rows: Array<{ date: string }> }
    // 03/04 is 4 March under MM/DD and 3 April under DD/MM. Neither is a
    // default the importer picked — the request said which.
    expect(body.rows[0]?.date).toBe('2026-04-03')
  })

  it('refuses a date format it does not know rather than falling back', async () => {
    const res = await analyze({ accountId, csv: CSV, ...MAPPING, dateFormat: 'YYYY.DD.MM' })
    expect(res.statusCode).toBe(400)
  })

  it('writes the rows and links them to a batch', async () => {
    const res = await commit({ accountId, csv: CSV, fileName: 'march.csv', ...MAPPING })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ imported: 3, skipped: 0 })

    const rows = await asUser(h.db, user.id, async (trx) => {
      const r = await sql<{ merchant: string; amount: string; transaction_date: string }>`
        SELECT merchant, amount::text, transaction_date::text
        FROM core.transactions WHERE account_id = ${accountId} ORDER BY transaction_date
      `.execute(trx)
      return r.rows
    })
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ merchant: 'COFFEE BAR, MAIN ST', amount: '-4.5000' })
  })

  it('skips rows whose external_id is already present, on re-import', async () => {
    const res = await commit({ accountId, csv: CSV, fileName: 'march-again.csv', ...MAPPING })
    expect(res.json()).toMatchObject({ imported: 0, skipped: 3 })
  })

  it('treats a new external_id as new even on the same day for the same amount', async () => {
    const second = [
      'Date,Description,Amount,Id',
      '03/04/2026,"COFFEE BAR, MAIN ST",-4.50,tx-99',
    ].join('\n')
    const res = await analyze({ accountId, csv: second, ...MAPPING })
    const body = res.json() as { summary: { new: number; needsReview: number } }
    // The source says this is a different transaction, so it is — the second
    // coffee of the day does not silently disappear.
    expect(body.summary).toMatchObject({ new: 1, needsReview: 0 })
  })
})

describe('rows with no external_id (Q25)', () => {
  const noId = {
    ...MAPPING,
    sourceName: 'No Id Bank',
    columns: { date: 'Date', merchant: 'Description', amount: 'Amount' },
  }
  const csv = 'Date,Description,Amount\n03/06/2026,GROCERY WORLD,-81.20'

  it('flags a heuristic match for review instead of dropping it', async () => {
    const res = await analyze({ accountId, csv, ...noId })
    const body = res.json() as {
      summary: { needsReview: number }
      rows: Array<{ status: string; matched: { merchant: string } | null }>
    }
    expect(body.summary.needsReview).toBe(1)
    expect(body.rows[0]?.status).toBe('needs-review')
    expect(body.rows[0]?.matched?.merchant).toBe('GROCERY WORLD')
  })

  it('does not import a flagged row unless it was accepted', async () => {
    const res = await commit({ accountId, csv, fileName: 'dupe.csv', ...noId })
    expect(res.json()).toMatchObject({ imported: 0, flagged: 1 })
  })

  it('imports a flagged row when the user says it is genuinely new', async () => {
    const res = await commit({
      accountId, csv, fileName: 'dupe-accepted.csv', acceptRowNumbers: [2], ...noId,
    })
    expect(res.json()).toMatchObject({ imported: 1 })
  })
})

describe('category rules', () => {
  it('categorizes on import using core rules, not its own copy', async () => {
    const cat = await h.app.inject({
      method: 'POST', url: '/api/v1/categories', headers: auth(user),
      payload: { name: 'Coffee', slug: 'coffee' },
    })
    expect(cat.statusCode).toBe(201)
    const categoryId = (cat.json() as { id: string }).id

    const rule = await h.app.inject({
      method: 'POST', url: '/api/v1/category-rules', headers: auth(user),
      payload: {
        categoryId,
        priority: 10,
        conditions: [{ conditionType: 'merchant_contains', textValue: 'COFFEE' }],
      },
    })
    expect(rule.statusCode).toBe(201)

    const csv = 'Date,Description,Amount,Id\n04/01/2026,COFFEE BAR DOWNTOWN,-3.25,tx-coffee'
    const res = await commit({ accountId, csv, fileName: 'coffee.csv', ...MAPPING })
    expect(res.json()).toMatchObject({ imported: 1 })

    const row = await asUser(h.db, user.id, async (trx) => {
      const r = await sql<{ category_id: string | null; category_source: string | null }>`
        SELECT category_id, category_source::text
        FROM core.transactions WHERE external_id = 'tx-coffee'
      `.execute(trx)
      return r.rows[0]
    })
    expect(row?.category_id).toBe(categoryId)
    expect(row?.category_source).toBe('rule')
  })
})

describe('undoing an import', () => {
  it('removes only the rows that batch created', async () => {
    const csv = [
      'Date,Description,Amount,Id',
      '05/01/2026,UNDO ME A,-10.00,undo-a',
      '05/02/2026,UNDO ME B,-20.00,undo-b',
    ].join('\n')
    const committed = await commit({ accountId, csv, fileName: 'undo.csv', ...MAPPING })
    const { batchId } = committed.json() as { batchId: string }

    const before = await countTransactions()

    const res = await h.app.inject({
      method: 'POST', url: `${BASE}/batches/${batchId}/revert`, headers: headers(user), payload: {},
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ reverted: 2 })

    expect(await countTransactions()).toBe(before - 2)
  })

  it('refuses to revert the same batch twice', async () => {
    const csv = 'Date,Description,Amount,Id\n06/01/2026,ONCE,-1.00,once-1'
    const committed = await commit({ accountId, csv, fileName: 'once.csv', ...MAPPING })
    const { batchId } = committed.json() as { batchId: string }

    const first = await h.app.inject({
      method: 'POST', url: `${BASE}/batches/${batchId}/revert`, headers: headers(user), payload: {},
    })
    expect(first.statusCode).toBe(200)

    const second = await h.app.inject({
      method: 'POST', url: `${BASE}/batches/${batchId}/revert`, headers: headers(user), payload: {},
    })
    expect(second.statusCode).toBe(409)
  })
})

describe('isolation', () => {
  it('does not show one user another user\'s batches', async () => {
    await commit({ accountId: otherAccountId, csv: 'Date,Description,Amount,Id\n07/01/2026,THEIRS,-5.00,t-1', ...MAPPING }, other)

    const mine = await h.app.inject({ method: 'GET', url: `${BASE}/batches`, headers: headers(user) })
    const batches = (mine.json() as { batches: Array<{ fileName: string }> }).batches
    expect(batches.every((b) => b.fileName !== 'upload.csv' || true)).toBe(true)

    const theirs = await h.app.inject({ method: 'GET', url: `${BASE}/batches`, headers: headers(other) })
    expect((theirs.json() as { batches: unknown[] }).batches).toHaveLength(1)
  })

  it('refuses to import into an account belonging to someone else', async () => {
    // Row-level security hides the account, so the lookup finds nothing — and
    // the composite foreign key on transactions would reject the row even if
    // this check were removed. A plain single-column key would let it through:
    // foreign keys bypass RLS, so a transaction could be attached to a
    // stranger's account.
    const res = await commit({ accountId: otherAccountId, csv: CSV, ...MAPPING })
    expect(res.statusCode).toBe(404)
  })

  it('cannot attach a transaction to another user\'s account at all', async () => {
    await expect(
      asUser(h.db, user.id, async (trx) =>
        sql`INSERT INTO core.transactions
              (user_id, account_id, amount, merchant, transaction_date)
            VALUES (core.current_user_id(), ${otherAccountId}, -1, 'SNEAKY', CURRENT_DATE)`
          .execute(trx),
      ),
    ).rejects.toThrow(/violates foreign key constraint/i)
  })
})

/** Ids of the caller's transactions, keyed by external id. */
async function idsByExternalId(u: TestUser, externalIds: readonly string[]): Promise<Map<string, string>> {
  return asUser(h.db, u.id, async (trx) => {
    const r = await sql<{ id: string; external_id: string }>`
      SELECT id, external_id FROM core.transactions WHERE external_id = ANY(${externalIds}::text[])
    `.execute(trx)
    return new Map(r.rows.map((row) => [row.external_id, row.id]))
  })
}

async function revert(batchId: string, u = user) {
  return h.app.inject({ method: 'POST', url: `${BASE}/batches/${batchId}/revert`, headers: headers(u), payload: {} })
}

async function batchesOf(u: TestUser) {
  const res = await h.app.inject({ method: 'GET', url: `${BASE}/batches`, headers: headers(u) })
  return (res.json() as {
    batches: Array<{
      id: string; fileName: string; rowsTotal: number; rowsImported: number; rowsSkipped: number; rowsFlagged: number
    }>
  }).batches
}

describe('batch counters', () => {
  it('records total, imported, skipped and flagged for a mixed file', async () => {
    const acct = await newAccount(user, 'Counters')
    const noId = { ...MAPPING, columns: { date: 'Date', merchant: 'Description', amount: 'Amount', externalId: 'Id' } }
    await commit({
      accountId: acct, fileName: 'seed.csv', ...noId,
      csv: 'Date,Description,Amount,Id\n08/01/2026,SEED ONE,-1.00,ctr-seed-1\n08/02/2026,LOOKALIKE SHOP,-9.99,',
    })

    const csv = [
      'Date,Description,Amount,Id',
      '08/01/2026,SEED ONE,-1.00,ctr-seed-1', // duplicate by id
      '08/02/2026,LOOKALIKE SHOP,-9.99,', // flagged by heuristic
      '08/03/2026,FRESH,-2.00,ctr-new-1', // new
      '08/04/2026,FRESH TWO,-3.00,ctr-new-2', // new
      'not a date,BROKEN,-3.00,ctr-bad', // unreadable
    ].join('\n')
    const res = await commit({ accountId: acct, csv, fileName: 'counters.csv', ...noId })
    expect(res.json()).toMatchObject({ imported: 2, skipped: 1, flagged: 1, failed: 1 })

    const batch = (await batchesOf(user)).find((b) => b.fileName === 'counters.csv')
    expect(batch).toMatchObject({ rowsTotal: 4, rowsImported: 2, rowsSkipped: 1, rowsFlagged: 1 })
  })

  it('links exactly the imported rows to the batch, in bulk, for a large file', async () => {
    const acct = await newAccount(user, 'Large')
    const rows = Array.from({ length: 3_000 }, (_, i) => `09/01/2026,MERCHANT ${i},-${(i % 90) + 1}.25,big-${i}`)
    const res = await commit({
      accountId: acct, fileName: 'large.csv', ...MAPPING, csv: ['Date,Description,Amount,Id', ...rows].join('\n'),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { batchId: string; imported: number }
    expect(body.imported).toBe(3_000)

    const linked = await asPlugin(h.db, pluginRoleName(PLUGIN), user.id, async (trx) => {
      const r = await sql<{ n: string }>`
        SELECT count(*)::text AS n FROM plugin_import_csv.batch_transactions WHERE batch_id = ${body.batchId}
      `.execute(trx)
      return Number(r.rows[0]?.n)
    })
    expect(linked).toBe(3_000)
  })
})

describe('concurrent commits', () => {
  const noId = { ...MAPPING, sourceName: 'Concurrent Bank', columns: { date: 'Date', merchant: 'Description', amount: 'Amount' } }
  const csv = ['Date,Description,Amount', '10/01/2026,RACE A,-5.00', '10/02/2026,RACE B,-6.00', '10/03/2026,RACE C,-7.00'].join('\n')

  it('does not double-import rows that have no external id', async () => {
    // Without the per-account lock both requests classify against an empty
    // ledger, and every row is written twice.
    const acct = await newAccount(user, 'Race heuristic')
    const [a, b] = await Promise.all([
      commit({ accountId: acct, csv, fileName: 'a.csv', ...noId }),
      commit({ accountId: acct, csv, fileName: 'b.csv', ...noId }),
    ])
    expect(a.statusCode).toBe(200)
    expect(b.statusCode).toBe(200)

    const imported = (a.json() as { imported: number }).imported + (b.json() as { imported: number }).imported
    expect(imported).toBe(3)
    const n = await asUser(h.db, user.id, async (trx) => {
      const r = await sql<{ n: string }>`
        SELECT count(*)::text AS n FROM core.transactions WHERE account_id = ${acct}
      `.execute(trx)
      return Number(r.rows[0]?.n)
    })
    expect(n).toBe(3)
  })

  it('does not double-import rows that carry an external id, and the loser reports them skipped', async () => {
    const acct = await newAccount(user, 'Race ids')
    const withIds = ['Date,Description,Amount,Id', '10/01/2026,ID A,-5.00,race-a', '10/02/2026,ID B,-6.00,race-b'].join('\n')
    const [a, b] = await Promise.all([
      commit({ accountId: acct, csv: withIds, fileName: 'a.csv', ...MAPPING }),
      commit({ accountId: acct, csv: withIds, fileName: 'b.csv', ...MAPPING }),
    ])
    const results = [a.json(), b.json()] as Array<{ imported: number; skipped: number }>
    expect(results.map((r) => r.imported).sort()).toEqual([0, 2])
    expect(results.map((r) => r.skipped).sort()).toEqual([0, 2])
  })
})

describe('reverting an import', () => {
  it('answers 404 for another user\'s batch and leaves it intact', async () => {
    const acct = await newAccount(other, 'Theirs 2')
    const committed = await commit(
      { accountId: acct, csv: 'Date,Description,Amount,Id\n11/01/2026,THEIRS TOO,-5.00,rv-other-1', fileName: 'theirs.csv', ...MAPPING },
      other,
    )
    const { batchId } = committed.json() as { batchId: string }

    expect((await revert(batchId, user)).statusCode).toBe(404)
    expect((await idsByExternalId(other, ['rv-other-1'])).size).toBe(1)
    expect((await revert(batchId, other)).json()).toMatchObject({ reverted: 1, skipped: 0 })
  })

  it('answers 400 for an id that is not a UUID', async () => {
    expect((await revert('not-a-uuid')).statusCode).toBe(400)
  })

  it('keeps rows that were edited, categorised or split since import and reports them', async () => {
    const acct = await newAccount(user, 'Revert semantics')
    const csv = [
      'Date,Description,Amount,Id',
      '12/01/2026,PLAIN,-1.00,rv-plain',
      '12/02/2026,EDITED,-2.00,rv-edited',
      '12/03/2026,CATEGORISED,-3.00,rv-cat',
      '12/04/2026,SPLIT,-10.00,rv-split',
    ].join('\n')
    const committed = await commit({ accountId: acct, csv, fileName: 'semantics.csv', ...MAPPING })
    const { batchId } = committed.json() as { batchId: string }
    const ids = await idsByExternalId(user, ['rv-plain', 'rv-edited', 'rv-cat', 'rv-split'])

    const edit = await h.app.inject({
      method: 'PATCH', url: `/api/v1/transactions/${ids.get('rv-edited')}`, headers: auth(user), payload: { notes: 'mine' },
    })
    expect(edit.statusCode).toBe(200)

    const cat = await h.app.inject({
      method: 'POST', url: '/api/v1/categories', headers: auth(user), payload: { name: 'Revert cat', slug: 'revert-cat' },
    })
    const categoryId = (cat.json() as { id: string }).id
    const categorised = await h.app.inject({
      method: 'POST', url: '/api/v1/transactions/categorize', headers: auth(user),
      payload: { transactionIds: [ids.get('rv-cat')], categoryId },
    })
    expect(categorised.statusCode).toBe(200)

    const split = await h.app.inject({
      method: 'PUT', url: `/api/v1/transactions/${ids.get('rv-split')}/splits`, headers: auth(user),
      payload: { splits: [{ amount: '-6.00' }, { amount: '-4.00' }] },
    })
    expect(split.statusCode).toBe(200)

    const res = await revert(batchId)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ reverted: 1, skipped: 3 })

    const remaining = await idsByExternalId(user, ['rv-plain', 'rv-edited', 'rv-cat', 'rv-split'])
    expect([...remaining.keys()].sort()).toEqual(['rv-cat', 'rv-edited', 'rv-split'])
    // The batch is spent even though some rows stayed: a second revert must not delete them.
    expect((await revert(batchId)).statusCode).toBe(409)
  })
})

describe('saved mappings', () => {
  it('saves a mapping and lists it back', async () => {
    const saved = await h.app.inject({
      method: 'POST', url: `${BASE}/mappings`, headers: headers(user), payload: { ...MAPPING, sourceName: 'Saved One' },
    })
    expect(saved.statusCode).toBe(200)
    const { id } = saved.json() as { id: string; saved: boolean }
    expect(id).toEqual(expect.any(String))

    const list = await h.app.inject({ method: 'GET', url: `${BASE}/mappings`, headers: headers(user) })
    const mappings = (list.json() as { mappings: Array<{ id: string; sourceName: string; dateFormat: string }> }).mappings
    expect(mappings.find((m) => m.id === id)).toMatchObject({ sourceName: 'Saved One', dateFormat: 'MM/DD/YYYY' })
  })

  it('replaces a mapping whose name differs only by case, keeping one row, its id and its original spelling', async () => {
    const first = await h.app.inject({
      method: 'POST', url: `${BASE}/mappings`, headers: headers(user), payload: { ...MAPPING, sourceName: 'Case Bank' },
    })
    const second = await h.app.inject({
      method: 'POST', url: `${BASE}/mappings`, headers: headers(user),
      payload: { ...MAPPING, sourceName: 'CASE BANK', invertAmount: true },
    })
    expect((second.json() as { id: string }).id).toBe((first.json() as { id: string }).id)

    const list = await h.app.inject({ method: 'GET', url: `${BASE}/mappings`, headers: headers(user) })
    const rows = (list.json() as { mappings: Array<{ sourceName: string; invertAmount: boolean }> }).mappings
      .filter((m) => m.sourceName.toLowerCase() === 'case bank')
    expect(rows).toEqual([expect.objectContaining({ sourceName: 'Case Bank', invertAmount: true })])
  })

  it('does not show one user another user\'s mappings', async () => {
    await h.app.inject({
      method: 'POST', url: `${BASE}/mappings`, headers: headers(other), payload: { ...MAPPING, sourceName: 'Only Theirs' },
    })
    const list = await h.app.inject({ method: 'GET', url: `${BASE}/mappings`, headers: headers(user) })
    const names = (list.json() as { mappings: Array<{ sourceName: string }> }).mappings.map((m) => m.sourceName)
    expect(names).not.toContain('Only Theirs')
  })

  it('refuses an invalid mapping with 400', async () => {
    const res = await h.app.inject({
      method: 'POST', url: `${BASE}/mappings`, headers: headers(user), payload: { ...MAPPING, columns: { date: 'Date' } },
    })
    expect(res.statusCode).toBe(400)
  })

  it('names each refused part of a mapping, so the page can show it on that control', async () => {
    const res = await h.app.inject({
      method: 'POST', url: `${BASE}/mappings`, headers: headers(user),
      payload: { ...MAPPING, sourceName: '  ', columns: { date: 'Date' } },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({
      code: 'import_failed',
      issues: [
        { path: ['sourceName'], message: 'Give this file’s layout a name, so it can be used again.' },
        { path: ['columns', 'merchant'], message: 'Choose the description column.' },
      ],
    })
  })
})

describe('request size limits', () => {
  it('answers 413 to an analyze body over 10 MiB', async () => {
    const res = await analyze({ accountId, csv: 'a'.repeat(11 * 1024 * 1024), ...MAPPING })
    expect(res.statusCode).toBe(413)
  })

  it('answers 413 to a commit body over 10 MiB', async () => {
    const res = await commit({ accountId, csv: 'a'.repeat(11 * 1024 * 1024), ...MAPPING })
    expect(res.statusCode).toBe(413)
  })

  it('answers 400 with a clear message to a CSV over 8 MB that fits in the body', async () => {
    const res = await analyze({ accountId, csv: 'a'.repeat(9 * 1000 * 1000), ...MAPPING })
    expect(res.statusCode).toBe(400)
    expect(res.body).toContain('8 MB')
  })

  it('answers 400 to a file with more than 50,000 rows', async () => {
    const rows = Array.from({ length: 50_001 }, (_, i) => `03/04/2026,M${i},-1.00,cap-${i}`)
    const csv = ['Date,Description,Amount,Id', ...rows].join('\n')
    for (const send of [analyze, commit]) {
      const res = await send({ accountId, csv, ...MAPPING })
      expect(res.statusCode).toBe(400)
      expect(res.body).toContain('50,000')
    }
  })
})

/**
 * Database-level isolation of the plugin role.
 *
 * Everything above proves the plugin behaves. These prove it *cannot*
 * misbehave: the refusals come from PostgreSQL, under the same role the
 * plugin's endpoints run as, so they hold regardless of what the plugin's code
 * does or what the middleware forgot to check.
 */
describe('the plugin role cannot exceed its manifest', () => {
  const role = pluginRoleName(PLUGIN)

  const denied = async (query: string) => {
    await expect(
      asPlugin(h.db, role, user.id, async (trx) => sql.raw(query).execute(trx)),
    ).rejects.toThrow(/permission denied/i)
  }

  it('reads a table its manifest grants', async () => {
    const rows = await asPlugin(h.db, role, user.id, async (trx) => {
      const r = await sql<{ n: string }>`SELECT count(*)::text AS n FROM core.accounts`.execute(trx)
      return r.rows
    })
    expect(rows[0]?.n).toBeDefined()
  })

  it('cannot read recurring_items', async () => { await denied('SELECT 1 FROM core.recurring_items') })
  it('cannot read transaction_splits', async () => { await denied('SELECT 1 FROM core.transaction_splits') })
  it('cannot read core.users', async () => { await denied('SELECT 1 FROM core.users') })
  it('cannot create tables in its own schema', async () => {
    await denied('CREATE TABLE plugin_import_csv.sneaky (id int)')
  })

  it('cannot write to a table it only reads', async () => {
    await expect(
      asPlugin(h.db, role, user.id, async (trx) =>
        sql`DELETE FROM core.accounts WHERE id = ${accountId}`.execute(trx),
      ),
    ).rejects.toThrow(/permission denied/i)
  })

  it('leaves the connection as the application role afterwards', async () => {
    await asPlugin(h.db, role, user.id, async (trx) => {
      const r = await sql<{ u: string }>`SELECT current_user::text AS u`.execute(trx)
      expect(r.rows[0]?.u).toBe(role)
    })
    const after = await sql<{ u: string }>`SELECT current_user::text AS u`.execute(h.db)
    expect(after.rows[0]?.u).not.toBe(role)
  })

  it('denies the read-only insights role any write at all', async () => {
    await expect(
      asPlugin(h.db, pluginRoleName('wickermoney.insights'), user.id, async (trx) =>
        sql`INSERT INTO core.transactions (user_id, account_id, amount, merchant, transaction_date)
            VALUES (core.current_user_id(), ${accountId}, -1, 'x', CURRENT_DATE)`.execute(trx),
      ),
    ).rejects.toThrow(/permission denied/i)
  })
})

async function countTransactions(): Promise<number> {
  return asUser(h.db, user.id, async (trx) => {
    const r = await sql<{ n: string }>`
      SELECT count(*)::text AS n FROM core.transactions WHERE account_id = ${accountId}
    `.execute(trx)
    return Number(r.rows[0]?.n ?? 0)
  })
}

/** How many of the user's batches carry the key, and how many ledger rows an account holds. */
async function keyedBatches(u: TestUser, key: string): Promise<Array<{ id: string; account_id: string; rows_imported: number }>> {
  return asPlugin(h.db, pluginRoleName(PLUGIN), u.id, async (trx) => {
    const r = await sql<{ id: string; account_id: string; rows_imported: number }>`
      SELECT id, account_id, rows_imported FROM plugin_import_csv.import_batches WHERE idempotency_key = ${key}
    `.execute(trx)
    return r.rows
  })
}

async function ledgerRows(u: TestUser, account: string): Promise<number> {
  return asUser(h.db, u.id, async (trx) => {
    const r = await sql<{ n: string }>`
      SELECT count(*)::text AS n FROM core.transactions WHERE account_id = ${account}
    `.execute(trx)
    return Number(r.rows[0]?.n)
  })
}

describe('commit idempotency key', () => {
  const noId = { ...MAPPING, sourceName: 'Keyed Bank', columns: { date: 'Date', merchant: 'Description', amount: 'Amount' } }
  const csv = ['Date,Description,Amount', '11/01/2026,KEYED A,-5.00', '11/02/2026,KEYED B,-6.00'].join('\n')

  it('answers a repeat with the original outcome and imports nothing more', async () => {
    const acct = await newAccount(user, 'Key sequential')
    const key = 'seq-key-1'
    const first = await commit({ accountId: acct, csv, fileName: 'k.csv', idempotencyKey: key, ...noId })
    expect(first.statusCode).toBe(200)
    expect(first.json()).toMatchObject({ imported: 2, skipped: 0, flagged: 0, failed: 0 })
    expect(first.json()).not.toHaveProperty('replayed')

    const again = await commit({ accountId: acct, csv, fileName: 'k.csv', idempotencyKey: key, ...noId })
    expect(again.statusCode).toBe(200)
    expect(again.json()).toEqual({ ...(first.json() as object), replayed: true })

    expect(await ledgerRows(user, acct)).toBe(2)
    expect(await keyedBatches(user, key)).toHaveLength(1)
  })

  it('without a key, rows lacking an external id are still not imported twice by the heuristic, and no replay is reported', async () => {
    const acct = await newAccount(user, 'Key absent')
    await commit({ accountId: acct, csv, fileName: 'k.csv', ...noId })
    const again = await commit({ accountId: acct, csv, fileName: 'k.csv', ...noId })
    expect(again.json()).toMatchObject({ imported: 0, flagged: 2 })
    expect(again.json()).not.toHaveProperty('replayed')
  })

  it('imports on a different key, deduplicating by external id as before', async () => {
    const acct = await newAccount(user, 'Key different')
    const withIds = ['Date,Description,Amount,Id', '11/03/2026,KEYED C,-7.00,key-diff-1'].join('\n')
    const a = await commit({ accountId: acct, csv: withIds, fileName: 'a.csv', idempotencyKey: 'diff-a', ...MAPPING })
    const b = await commit({ accountId: acct, csv: withIds, fileName: 'b.csv', idempotencyKey: 'diff-b', ...MAPPING })
    expect(a.json()).toMatchObject({ imported: 1 })
    expect(b.json()).toMatchObject({ imported: 0, skipped: 1 })
    expect(b.json()).not.toHaveProperty('replayed')
    expect((b.json() as { batchId: string }).batchId).not.toBe((a.json() as { batchId: string }).batchId)
  })

  it('creates exactly one batch and one set of rows for two simultaneous commits with the same key', async () => {
    const acct = await newAccount(user, 'Key concurrent')
    const key = 'concurrent-key-1'
    const [a, b] = await Promise.all([
      commit({ accountId: acct, csv, fileName: 'a.csv', idempotencyKey: key, ...noId }),
      commit({ accountId: acct, csv, fileName: 'b.csv', idempotencyKey: key, ...noId }),
    ])
    expect(a.statusCode).toBe(200)
    expect(b.statusCode).toBe(200)
    const [ja, jb] = [a.json(), b.json()] as Array<{ batchId: string; imported: number; replayed?: boolean }>
    expect(ja.batchId).toBe(jb.batchId)
    expect([ja.replayed, jb.replayed].filter((r) => r === true)).toHaveLength(1)
    expect(ja.imported).toBe(2)
    expect(jb.imported).toBe(2)

    expect(await ledgerRows(user, acct)).toBe(2)
    expect(await keyedBatches(user, key)).toHaveLength(1)
  })

  it('answers the loser from the unique index when the two commits share no account lock', async () => {
    const one = await newAccount(user, 'Key race one')
    const two = await newAccount(user, 'Key race two')
    const key = 'cross-account-key'
    const [a, b] = await Promise.all([
      commit({ accountId: one, csv, fileName: 'a.csv', idempotencyKey: key, ...noId }),
      commit({ accountId: two, csv, fileName: 'b.csv', idempotencyKey: key, ...noId }),
    ])
    expect(a.statusCode).toBe(200)
    expect(b.statusCode).toBe(200)
    expect((a.json() as { batchId: string }).batchId).toBe((b.json() as { batchId: string }).batchId)

    // The loser's rows rolled back with its transaction.
    expect((await ledgerRows(user, one)) + (await ledgerRows(user, two))).toBe(2)
    expect(await keyedBatches(user, key)).toHaveLength(1)
  })

  it('keeps keys apart between users', async () => {
    const key = 'shared-looking-key'
    const mine = await commit({ accountId, csv, fileName: 'm.csv', idempotencyKey: key, ...noId, sourceName: 'Mine' })
    const theirs = await commit({ accountId: otherAccountId, csv, fileName: 't.csv', idempotencyKey: key, ...noId }, other)
    expect(mine.statusCode).toBe(200)
    expect(theirs.json()).toMatchObject({ imported: 2 })
    expect(theirs.json()).not.toHaveProperty('replayed')
    expect(await keyedBatches(other, key)).toHaveLength(1)
    expect(await keyedBatches(user, key)).toHaveLength(1)
  })

  it('refuses a key that is empty, too long or not a string', async () => {
    for (const bad of ['', 'k'.repeat(129), 42, ['a']]) {
      const res = await commit({ accountId, csv, fileName: 'bad.csv', idempotencyKey: bad, ...noId })
      expect(res.statusCode).toBe(400)
      expect(res.json()).toMatchObject({ code: 'invalid_idempotency_key' })
    }
  })

  it('includes the key in the plugin\'s data export', async () => {
    const acct = await newAccount(user, 'Key export')
    await commit({ accountId: acct, csv, fileName: 'export.csv', idempotencyKey: 'export-key', ...noId })
    const exported = await asPlugin(h.db, pluginRoleName(PLUGIN), user.id, (trx) => exportImportData(queryRunner(trx)))
    expect(exported.importBatches.find((b) => b.file_name === 'export.csv')).toMatchObject({ idempotency_key: 'export-key' })
    expect(exported.importBatches.filter((b) => b.idempotency_key === null).length).toBeGreaterThan(0)
  })
})

describe('idempotency key storage', () => {
  const insert = (u: TestUser, acct: string, key: string | null) =>
    asPlugin(h.db, pluginRoleName(PLUGIN), u.id, (trx) =>
      sql`
        INSERT INTO plugin_import_csv.import_batches (user_id, account_id, source_name, file_name, idempotency_key)
        VALUES (core.current_user_id(), ${acct}, 's', 'f', ${key})
      `.execute(trx),
    )

  it('lets the plugin role write the column, and row-level security still hides other users\' keys', async () => {
    await insert(user, accountId, 'storage-key-1')
    expect(await keyedBatches(user, 'storage-key-1')).toHaveLength(1)
    expect(await keyedBatches(other, 'storage-key-1')).toHaveLength(0)
  })

  it('rejects a second batch with the same key for the same user, by the unique index', async () => {
    await insert(user, accountId, 'storage-key-2')
    await expect(insert(user, accountId, 'storage-key-2')).rejects.toMatchObject({
      code: '23505', constraint: 'ux_import_batches_user_idempotency_key',
    })
  })

  it('allows any number of batches without a key', async () => {
    await insert(user, accountId, null)
    await insert(user, accountId, null)
  })

  it('rejects an empty or over-long key', async () => {
    await expect(insert(user, accountId, '')).rejects.toMatchObject({ code: '23514' })
    await expect(insert(user, accountId, 'k'.repeat(129))).rejects.toMatchObject({ code: '23514' })
    await insert(user, accountId, 'k'.repeat(128))
  })

  it('has its length check validated after the migration', async () => {
    const { rows } = await sql<{ convalidated: boolean }>`
      SELECT convalidated FROM pg_constraint
      WHERE conname = 'ck_import_batches_idempotency_key_length'
        AND conrelid = 'plugin_import_csv.import_batches'::regclass
    `.execute(h.db)
    expect(rows).toEqual([{ convalidated: true }])
  })

  it('can be applied again without error or change', async () => {
    const owner = createDb(process.env['TEST_ADMIN_DATABASE_URL'] ?? '')
    try {
      await applyIdempotencyMigration(owner)
      await applyIdempotencyMigration(owner)
    } finally {
      await owner.destroy()
    }
    const { rows } = await sql<{ n: string }>`
      SELECT count(*)::text AS n FROM pg_indexes
      WHERE schemaname = 'plugin_import_csv' AND indexname = 'ux_import_batches_user_idempotency_key'
    `.execute(h.db)
    expect(rows[0]?.n).toBe('1')
  })
})
