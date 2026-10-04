import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { KyselyUnitOfWork } from '../data/KyselyUnitOfWork.js'
import { asUser } from '../db/client.js'
import { pluginRoleName } from '../db/plugin-roles.js'
import { PluginSqlRejectedError } from '../plugins/PluginSqlRejectedError.js'
import { PluginService } from '../plugins/service/PluginService.js'
import { auth, createHarness, createUser, type Harness, type TestUser } from '../testing/harness.js'
import type { PluginExporter } from './service/PluginExporter.js'
import { SettingsService } from './service/SettingsService.js'

const BUDGETS = 'wickermoney.budgets'
const IMPORT = 'wickermoney.import-csv'

let h: Harness

beforeAll(async () => {
  h = await createHarness()
  const { seedBundledPlugins } = await import('../plugins/registry.js')
  await seedBundledPlugins(h.db)
})
afterAll(async () => { await h.close() })

interface Fixture {
  readonly user: TestUser
  readonly accountId: string
  readonly categoryId: string
  readonly otherCategoryId: string
  readonly transactionId: string
  readonly ruleId: string
}

async function send(
  u: TestUser, method: 'POST' | 'PUT', url: string, payload: Record<string, unknown>, plugin?: string,
): Promise<Record<string, unknown>> {
  const res = await h.app.inject({
    method, url, payload,
    headers: { ...auth(u), ...(plugin === undefined ? {} : { 'x-wickermoney-plugin': plugin }) },
  })
  if (res.statusCode >= 300) throw new Error(`${method} ${url} failed: ${res.statusCode} ${res.body}`)
  return res.json() as Record<string, unknown>
}

/** Gives a user one of everything an export should carry, tagged with `label` so rows can be told apart. */
async function fixture(label: string): Promise<Fixture> {
  const user = await createUser(h)
  const account = await send(user, 'POST', '/api/v1/accounts', { name: `${label} account`, accountType: 'checking' })
  const cat = await send(user, 'POST', '/api/v1/categories', { name: `${label} groceries`, slug: `groceries-${label}` })
  const other = await send(user, 'POST', '/api/v1/categories', { name: `${label} dining`, slug: `dining-${label}` })
  const tx = await send(user, 'POST', '/api/v1/transactions', {
    accountId: account['id'], amount: '-90.00', merchant: `${label} shop`,
    transactionDate: '2026-03-10', categoryId: cat['id'],
  })
  await send(user, 'PUT', `/api/v1/transactions/${tx['id']}/splits`, {
    splits: [
      { amount: '-60.00', categoryId: cat['id'] },
      { amount: '-30.00', categoryId: other['id'] },
    ],
  })
  const rule = await send(user, 'POST', '/api/v1/category-rules', {
    categoryId: cat['id'], priority: 0,
    conditions: [{ conditionType: 'merchant_contains', textValue: `${label}-rule` }],
  })
  await send(user, 'PUT', `/api/v1/p/${BUDGETS}/line`,
    { month: '2026-03', categoryId: cat['id'], planned: '400.0000', rollover: false }, BUDGETS)
  await send(user, 'POST', `/api/v1/p/${IMPORT}/commit`, {
    accountId: account['id'], fileName: `${label}.csv`,
    csv: `Date,Description,Amount,Id\n03/04/2026,${label} IMPORTED,-4.50,${label}-1`,
    sourceName: `${label} Bank`,
    columns: { date: 'Date', merchant: 'Description', amount: 'Amount', externalId: 'Id' },
    dateFormat: 'MM/DD/YYYY', amountStyle: 'signed', invertAmount: false,
  }, IMPORT)
  return {
    user, accountId: account['id'] as string, categoryId: cat['id'] as string,
    otherCategoryId: other['id'] as string, transactionId: tx['id'] as string, ruleId: (rule['rule'] as { id: string }).id,
  }
}

interface ExportDoc {
  exportedAt: string
  core: {
    profile: { id: string; email: string } & Record<string, unknown>
    accounts: Array<{ id: string; name: string }>
    categories: Array<{ id: string }>
    categoryRules: Array<{ id: string }>
    categoryRuleConditions: Array<{ rule_id: string; text_value: string }>
    transactions: Array<{ id: string; merchant: string }>
    transactionSplits: Array<{ transaction_id: string; category_id: string; amount: string }>
    recurringItems: unknown[]
  } & Record<string, unknown>
  plugins: Record<string, Record<string, Array<Record<string, unknown>>>>
}

async function exportFor(u: TestUser): Promise<{ body: string; doc: ExportDoc; headers: Record<string, unknown> }> {
  const res = await h.app.inject({ method: 'GET', url: '/api/v1/settings/export', headers: auth(u) })
  expect(res.statusCode).toBe(200)
  return { body: res.body, doc: JSON.parse(res.body) as ExportDoc, headers: res.headers }
}

describe('GET /api/v1/settings/export', () => {
  let alice: Fixture
  let bob: Fixture

  beforeAll(async () => {
    alice = await fixture('alice')
    bob = await fixture('bob')
  })

  it('requires authentication', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/settings/export' })
    expect(res.statusCode).toBe(401)
  })

  it('is served as a JSON file download that parses', async () => {
    const { doc, headers } = await exportFor(alice.user)
    expect(String(headers['content-type'])).toContain('application/json')
    expect(String(headers['content-disposition'])).toMatch(/^attachment; filename="wickermoney-export-\d{4}-\d{2}-\d{2}\.json"$/)
    expect(Object.keys(doc)).toEqual(['exportedAt', 'core', 'plugins'])
    expect(Object.keys(doc.core)).toEqual([
      'profile', 'accounts', 'categories', 'categoryRules', 'categoryRuleConditions',
      'transactions', 'transactionSplits', 'recurringItems', 'recurringItemLegs',
      'recurringOccurrences', 'recurringOccurrenceLegs', 'recurringMatchDismissals',
    ])
    expect(new Date(doc.exportedAt).toString()).not.toBe('Invalid Date')
  })

  it('contains only the caller\'s rows, for each of two users', async () => {
    const a = (await exportFor(alice.user)).doc
    const b = (await exportFor(bob.user)).doc

    expect(a.core.profile.id).toBe(alice.user.id)
    expect(a.core.profile.email).toBe(alice.user.email)
    expect(a.core.accounts.map((r) => r.name)).toEqual(['alice account'])
    expect(b.core.accounts.map((r) => r.name)).toEqual(['bob account'])

    expect(a.core.transactions.every((t) => t.merchant.startsWith('alice'))).toBe(true)
    expect(b.core.transactions.every((t) => t.merchant.startsWith('bob'))).toBe(true)

    const aBody = JSON.stringify(a)
    const bBody = JSON.stringify(b)
    for (const id of [bob.user.id, bob.accountId, bob.categoryId, bob.transactionId, bob.ruleId, bob.user.email]) {
      expect(aBody).not.toContain(id)
    }
    for (const id of [alice.user.id, alice.accountId, alice.categoryId, alice.transactionId, alice.ruleId, alice.user.email]) {
      expect(bBody).not.toContain(id)
    }
  })

  it('includes splits, rules with their conditions, categories and transactions', async () => {
    const { doc } = await exportFor(alice.user)

    expect(doc.core.categories.map((c) => c.id).sort()).toEqual([alice.categoryId, alice.otherCategoryId].sort())
    expect(doc.core.transactions.map((t) => t.id)).toContain(alice.transactionId)

    const splits = doc.core.transactionSplits.filter((s) => s.transaction_id === alice.transactionId)
    expect(splits.map((s) => [s.category_id, s.amount]).sort()).toEqual([
      [alice.categoryId, '-60.0000'],
      [alice.otherCategoryId, '-30.0000'],
    ].sort())

    expect(doc.core.categoryRules.map((r) => r.id)).toEqual([alice.ruleId])
    expect(doc.core.categoryRuleConditions).toEqual([
      expect.objectContaining({ rule_id: alice.ruleId, text_value: 'alice-rule' }),
    ])
  })

  it('includes each bundled plugin\'s own data, and only the caller\'s', async () => {
    const { doc } = await exportFor(alice.user)
    expect(Object.keys(doc.plugins).sort()).toEqual([BUDGETS, IMPORT].sort())

    expect(doc.plugins[BUDGETS]?.['budgetLines']).toEqual([
      expect.objectContaining({ category_id: alice.categoryId, period_start: '2026-03-01' }),
    ])
    expect(doc.plugins[IMPORT]?.['importBatches']).toEqual([
      expect.objectContaining({ file_name: 'alice.csv', account_id: alice.accountId }),
    ])
    expect(JSON.stringify(doc.plugins)).not.toContain('bob')
  })

  it('never includes password hashes or sessions', async () => {
    const hash = await asUser(h.db, alice.user.id, async (trx) => {
      const row = await trx.selectFrom('core.users').select('password_hash').where('id', '=', alice.user.id).executeTakeFirstOrThrow()
      return row.password_hash
    })
    expect(hash.length).toBeGreaterThan(20)

    const { body, doc } = await exportFor(alice.user)
    expect(body).not.toContain(hash)
    expect(body).not.toContain(alice.user.refreshToken)
    expect(body).not.toContain('password')
    expect(body).not.toContain('token_hash')
    expect(Object.keys(doc.core.profile).sort()).toEqual(
      ['created_at', 'email', 'id', 'onboarded_at', 'onboarding_situations', 'timezone'].sort(),
    )
    expect(Object.keys(doc.core)).not.toContain('sessions')
  })

  it('has empty collections, not missing ones, for a user with no data', async () => {
    const empty = await createUser(h)
    const { doc } = await exportFor(empty)
    expect(doc.core.accounts).toEqual([])
    expect(doc.core.transactionSplits).toEqual([])
    expect(doc.plugins[BUDGETS]).toEqual({ budgetLines: [] })
  })
})

describe('export paging', () => {
  it('writes every row of a table larger than one page, once and in order', async () => {
    const u = await createUser(h)
    const account = await send(u, 'POST', '/api/v1/accounts', { name: 'Big', accountType: 'checking' })
    await asUser(h.db, u.id, (trx) => sql`
      INSERT INTO core.transactions (user_id, account_id, amount, merchant, transaction_date)
      SELECT ${u.id}::uuid, ${account['id'] as string}::uuid, -1.00, 'bulk ' || n, DATE '2026-01-01' + (n % 28)
      FROM generate_series(1, 1203) AS n
    `.execute(trx))

    const chunks: string[] = []
    const service = settingsService()
    await service.exportUserData(u.id, { write: async (c) => { chunks.push(c) } })

    const doc = JSON.parse(chunks.join('')) as ExportDoc
    const ids = doc.core.transactions.map((t) => t.id)
    expect(ids).toHaveLength(1203)
    expect(new Set(ids).size).toBe(1203)
    expect([...ids].sort()).toEqual(ids)
    // Streamed in pieces rather than assembled first: at least one chunk per page.
    expect(chunks.length).toBeGreaterThan(3)
    expect(Math.max(...chunks.map((c) => c.length))).toBeLessThan(500 * 1000)
  })
})

function settingsService(exporters?: Readonly<Record<string, PluginExporter>>): SettingsService {
  const uow = new KyselyUnitOfWork(h.db)
  return new SettingsService(uow, {
    config: h.config,
    plugins: new PluginService(uow, { cacheTtlMs: 0 }),
    ...(exporters === undefined ? {} : { exporters }),
  })
}

describe('export snapshot', () => {
  it('shows core tables and plugin data as of one instant, even while the user keeps writing', async () => {
    const f = await fixture('snap')
    let raced = false
    const chunks: string[] = []

    await settingsService().exportUserData(f.user.id, {
      write: async (chunk) => {
        chunks.push(chunk)
        if (raced) return
        raced = true
        // The export has started. Commit changes to a core table and to plugin
        // data from other connections; a snapshot must not show either.
        await send(f.user, 'POST', '/api/v1/accounts', { name: 'added mid-export', accountType: 'savings' })
        await send(f.user, 'PUT', `/api/v1/p/${BUDGETS}/line`,
          { month: '2026-04', categoryId: f.categoryId, planned: '10.0000', rollover: false }, BUDGETS)
      },
    })

    const doc = JSON.parse(chunks.join('')) as ExportDoc
    expect(doc.core.accounts.map((a) => a.name)).toEqual(['snap account'])
    expect(doc.plugins[BUDGETS]?.['budgetLines']).toHaveLength(1)

    // The writes did commit: a later export sees them.
    const later = (await exportFor(f.user)).doc
    expect(later.core.accounts).toHaveLength(2)
    expect(later.plugins[BUDGETS]?.['budgetLines']).toHaveLength(2)
  })
})

describe('plugin exporters run under the host-managed role', () => {
  const whoAmI: PluginExporter = async (q) => q`SELECT current_user::text AS role`

  it('assumes each plugin\'s own role, releases it between plugins, and exports as the caller', async () => {
    const u = await createUser(h)
    const chunks: string[] = []
    await settingsService({ [BUDGETS]: whoAmI, [IMPORT]: whoAmI })
      .exportUserData(u.id, { write: async (c) => { chunks.push(c) } })

    const doc = JSON.parse(chunks.join('')) as { plugins: Record<string, Array<{ role: string }>> }
    expect(doc.plugins[BUDGETS]?.[0]?.role).toBe(pluginRoleName(BUDGETS))
    expect(doc.plugins[IMPORT]?.[0]?.role).toBe(pluginRoleName(IMPORT))
  })

  it('cannot read a core table its manifest did not grant', async () => {
    const u = await createUser(h)
    const snoop: PluginExporter = async (q) => q`SELECT count(*) FROM core.accounts`
    await expect(
      settingsService({ [BUDGETS]: snoop }).exportUserData(u.id, { write: async () => undefined }),
    ).rejects.toThrow(/permission denied/)
  })

  it('cannot use the runner to drop its role', async () => {
    const u = await createUser(h)
    const escape: PluginExporter = async (q) => q`RESET ROLE`
    await expect(
      settingsService({ [BUDGETS]: escape }).exportUserData(u.id, { write: async () => undefined }),
    ).rejects.toBeInstanceOf(PluginSqlRejectedError)
  })

  it('stops reading when the consumer goes away, and frees the connection', async () => {
    const u = await createUser(h)
    await send(u, 'POST', '/api/v1/accounts', { name: 'A', accountType: 'checking' })
    await expect(
      settingsService().exportUserData(u.id, {
        write: () => Promise.reject(new Error('client disconnected')),
      }),
    ).rejects.toThrow('client disconnected')

    // The pool still works, so the transaction was rolled back and released.
    const { rows } = await sql<{ ok: number }>`SELECT 1 AS ok`.execute(h.db)
    expect(rows[0]?.ok).toBe(1)
  })
})

describe('GET /api/v1/settings/config', () => {
  it('requires authentication', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/settings/config' })
    expect(res.statusCode).toBe(401)
  })

  it('reports allow-listed facts and no secrets', async () => {
    const u = await createUser(h)
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/settings/config', headers: auth(u) })
    expect(res.statusCode).toBe(200)
    const body = res.json() as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(
      ['appRole', 'databaseName', 'latestMigration', 'logLevel', 'nodeEnv', 'port'].sort(),
    )
    expect(body['databaseName']).toBe(new URL(h.config.DATABASE_URL).pathname.slice(1))
    expect(typeof body['latestMigration']).toBe('string')
    expect(res.body).not.toContain(h.config.AUTH_SECRET)
    expect(res.body).not.toContain('testpw')
  })
})
