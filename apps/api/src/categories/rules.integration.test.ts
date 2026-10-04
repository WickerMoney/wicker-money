import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asUser } from '../db/client.js'
import { auth, createHarness, createUser, type Harness, type TestUser } from '../testing/harness.js'

let h: Harness
let user: TestUser
let other: TestUser
let accountId: string
let savingsId: string
let coffee: string
let dining: string
let theirCategory: string

const ABSENT = '00000000-0000-4000-8000-0000000000ff'

interface RuleCondition {
  id: string
  rule_id: string
  condition_type: string
  text_value: string | null
  is_case_sensitive: boolean
  direction: string | null
  amount_value: string | null
  amount_min: string | null
  amount_max: string | null
}
interface Rule {
  id: string
  category_id: string
  priority: number
  created_at: string
  conditions: RuleCondition[]
}

const contains = (textValue: string, isCaseSensitive = false) => ({
  conditionType: 'merchant_contains', textValue, isCaseSensitive,
})

async function call(method: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown, u = user) {
  return h.app.inject({ method, url, headers: auth(u), ...(payload === undefined ? {} : { payload }) })
}

async function createRule(body: Record<string, unknown>, u = user): Promise<{ rule: Rule; recategorized: number }> {
  const res = await call('POST', '/api/v1/category-rules', body, u)
  if (res.statusCode !== 201) throw new Error(`create rule failed: ${res.statusCode} ${res.body}`)
  return res.json() as { rule: Rule; recategorized: number }
}

async function newCategory(name: string, slug: string, u = user): Promise<string> {
  const res = await call('POST', '/api/v1/categories', { name, slug }, u)
  return (res.json() as { id: string }).id
}

/** Inserts rows straight into the ledger, as the application role, so a test can choose the source and the volume. */
async function seed(
  merchant: string,
  count: number,
  opts: { categoryId?: string; source?: string; amount?: string } = {},
): Promise<void> {
  await asUser(h.db, user.id, async (trx) => {
    await sql`
      INSERT INTO core.transactions
        (user_id, account_id, amount, merchant, transaction_date, category_id, category_source)
      SELECT ${user.id}::uuid, ${accountId}::uuid, ${opts.amount ?? '-5.0000'}::numeric,
             ${merchant} || ' ' || g, DATE '2026-01-01',
             ${opts.categoryId ?? null}::uuid, ${opts.source ?? null}::core.category_source
      FROM generate_series(1, ${count}) g
    `.execute(trx)
  })
}

async function tally(likeMerchant: string): Promise<Record<string, number>> {
  return asUser(h.db, user.id, async (trx) => {
    const r = await sql<{ k: string; n: string }>`
      SELECT coalesce(category_id::text, 'none') || '/' || coalesce(category_source::text, 'none') AS k,
             count(*) AS n
      FROM core.transactions WHERE merchant LIKE ${likeMerchant} GROUP BY 1
    `.execute(trx)
    return Object.fromEntries(r.rows.map((x) => [x.k, Number(x.n)]))
  })
}

beforeAll(async () => {
  h = await createHarness()
  user = await createUser(h)
  other = await createUser(h)
  const account = async (name: string) =>
    ((await call('POST', '/api/v1/accounts', { name, accountType: 'checking', openingBalance: '0.00' })).json() as { id: string }).id
  accountId = await account('Everyday')
  savingsId = await account('Savings')
  coffee = await newCategory('Coffee', 'coffee')
  dining = await newCategory('Dining', 'dining')
  theirCategory = await newCategory('Theirs', 'theirs', other)
})
afterAll(async () => {
  await h.close()
})

describe('listing category rules', () => {
  it('orders by priority, then condition count, then creation time', async () => {
    const a = await createRule({ categoryId: coffee, priority: 0, conditions: [contains('zz-order-a')] })
    const b = await createRule({
      categoryId: coffee, priority: 0,
      conditions: [contains('zz-order-b'), { conditionType: 'amount_exact', direction: 'out', amountValue: '1.11' }],
    })
    const c = await createRule({ categoryId: dining, priority: 5, conditions: [contains('zz-order-c')] })
    const d = await createRule({ categoryId: dining, priority: 0, conditions: [contains('zz-order-d')] })

    const res = await call('GET', '/api/v1/category-rules')
    const ids = (res.json() as Rule[]).map((r) => r.id)
    const mine = [c, b, a, d].map((x) => x.rule.id)

    expect(res.statusCode).toBe(200)
    // Highest priority first (c), then among equals the more specific rule (b, two
    // conditions), then oldest first (a before d).
    expect(ids.filter((id) => mine.includes(id))).toEqual(mine)
  })

  it('returns each rule with exactly its own conditions', async () => {
    const created = await createRule({
      categoryId: coffee, priority: 3,
      conditions: [contains('zz-shape'), { conditionType: 'amount_range', direction: 'out', amountMin: '2' }],
    })

    const listed = (await call('GET', '/api/v1/category-rules')).json() as Rule[]
    const rule = listed.find((r) => r.id === created.rule.id)

    expect(rule).toMatchObject({ category_id: coffee, priority: 3 })
    expect(rule?.conditions.map((c) => c.condition_type).sort()).toEqual(['amount_range', 'merchant_contains'])
    expect(rule?.conditions.every((c) => c.rule_id === created.rule.id)).toBe(true)
  })

  it("does not list another user's rules", async () => {
    const theirs = await createRule({ categoryId: theirCategory, conditions: [contains('zz-theirs')] }, other)

    const mine = (await call('GET', '/api/v1/category-rules')).json() as Rule[]

    expect(mine.some((r) => r.id === theirs.rule.id)).toBe(false)
    expect(((await call('GET', '/api/v1/category-rules', undefined, other)).json() as Rule[]).map((r) => r.id)).toEqual([
      theirs.rule.id,
    ])
  })
})

describe('creating a rule', () => {
  it('responds 201 with the rule, its conditions and how many transactions it categorized', async () => {
    await seed('ZZCREATE SHOP', 3)
    const res = await call('POST', '/api/v1/category-rules', { categoryId: coffee, conditions: [contains('zzcreate shop')] })

    expect(res.statusCode).toBe(201)
    const body = res.json() as { rule: Rule; recategorized: number }
    expect(body.recategorized).toBe(3)
    expect(body.rule).toMatchObject({ category_id: coffee, priority: 0 })
    expect(body.rule.conditions).toHaveLength(1)
    expect(await tally('ZZCREATE SHOP%')).toEqual({ [`${coffee}/rule`]: 3 })
  })

  it('applies to uncategorized rows only by default, and to non-manual ones with applyToExisting', async () => {
    await seed('ZZSCOPE IMPORTED', 2, { categoryId: dining, source: 'import' })
    await seed('ZZSCOPE MANUAL', 2, { categoryId: dining, source: 'manual' })
    await seed('ZZSCOPE NEW', 2)

    const first = await createRule({ categoryId: coffee, conditions: [contains('zzscope')] })
    expect(first.recategorized).toBe(2)
    expect(await tally('ZZSCOPE IMPORTED%')).toEqual({ [`${dining}/import`]: 2 })

    const second = await createRule({ categoryId: coffee, conditions: [contains('zzscope')], applyToExisting: true })
    expect(second.recategorized).toBe(4) // the two new-now-rule rows plus the two imported ones
    expect(await tally('ZZSCOPE IMPORTED%')).toEqual({ [`${coffee}/rule`]: 2 })
    expect(await tally('ZZSCOPE MANUAL%')).toEqual({ [`${dining}/manual`]: 2 })
  })

  it('never touches transfer legs', async () => {
    const res = await call('POST', '/api/v1/transactions/transfer', {
      fromAccountId: accountId, toAccountId: savingsId, amount: '10.00',
      transactionDate: '2026-02-02', description: 'ZZTRANSFER to savings',
    })
    expect(res.statusCode).toBe(201)

    const rule = await createRule({ categoryId: coffee, conditions: [contains('zztransfer')], applyToExisting: true })

    expect(rule.recategorized).toBe(0)
    expect(await tally('ZZTRANSFER%')).toEqual({ 'none/none': 2 })
  })

  it("never touches another user's transactions", async () => {
    await asUser(h.db, other.id, async (trx) => {
      const acc = await sql<{ id: string }>`
        INSERT INTO core.accounts (user_id, name, account_type) VALUES (${other.id}, 'Theirs', 'checking') RETURNING id
      `.execute(trx)
      await sql`
        INSERT INTO core.transactions (user_id, account_id, amount, merchant, transaction_date)
        VALUES (${other.id}, ${acc.rows[0]?.id as string}, -1, 'ZZFOREIGN COFFEE', DATE '2026-01-01')
      `.execute(trx)
    })

    expect((await createRule({ categoryId: coffee, conditions: [contains('zzforeign')] })).recategorized).toBe(0)
    const left = await asUser(h.db, other.id, async (trx) =>
      sql<{ category_id: string | null }>`SELECT category_id FROM core.transactions WHERE merchant = 'ZZFOREIGN COFFEE'`.execute(trx),
    )
    expect(left.rows).toEqual([{ category_id: null }])
  })

  it('refuses a category that belongs to someone else, and stores no rule', async () => {
    const before = ((await call('GET', '/api/v1/category-rules')).json() as Rule[]).length

    const res = await call('POST', '/api/v1/category-rules', { categoryId: theirCategory, conditions: [contains('zz-foreign-cat')] })

    // Row-level security hides the category, so it reads as absent, not forbidden.
    expect(res.statusCode).toBe(404)
    expect(res.json()).toMatchObject({ code: 'not_found' })
    expect(((await call('GET', '/api/v1/category-rules')).json() as Rule[]).length).toBe(before)
  })

  it('refuses a category that does not exist', async () => {
    const res = await call('POST', '/api/v1/category-rules', { categoryId: ABSENT, conditions: [contains('zz-absent-cat')] })
    expect(res.statusCode).toBe(404)
  })
})

describe('previewing a rule', () => {
  it('counts what would change without changing it or storing a rule', async () => {
    await seed('ZZPREVIEW NEW', 3)
    await seed('ZZPREVIEW IMPORTED', 2, { categoryId: dining, source: 'import' })
    await seed('ZZPREVIEW MANUAL', 4, { categoryId: dining, source: 'manual' })
    const rulesBefore = ((await call('GET', '/api/v1/category-rules')).json() as Rule[]).length

    const plain = await call('POST', '/api/v1/category-rules/preview', { categoryId: coffee, conditions: [contains('zzpreview')] })
    const all = await call('POST', '/api/v1/category-rules/preview', {
      categoryId: coffee, conditions: [contains('zzpreview')], applyToExisting: true,
    })

    expect(plain.statusCode).toBe(200)
    expect(plain.json()).toEqual({ wouldCategorize: 3, wouldRecategorize: 0 })
    expect(all.json()).toEqual({ wouldCategorize: 3, wouldRecategorize: 2 })
    expect(await tally('ZZPREVIEW%')).toEqual({
      'none/none': 3, [`${dining}/import`]: 2, [`${dining}/manual`]: 4,
    })
    expect(((await call('GET', '/api/v1/category-rules')).json() as Rule[]).length).toBe(rulesBefore)
  })

  it('predicts exactly what creating the same rule then does', async () => {
    await seed('ZZAGREE', 5)
    await seed('ZZAGREE OLD', 2, { categoryId: dining, source: 'rule' })
    const body = { categoryId: coffee, conditions: [contains('zzagree')], applyToExisting: true }

    const preview = (await call('POST', '/api/v1/category-rules/preview', body)).json() as {
      wouldCategorize: number
      wouldRecategorize: number
    }
    const created = await createRule(body)

    expect(created.recategorized).toBe(preview.wouldCategorize + preview.wouldRecategorize)
  })

  it('validates the same way creation does', async () => {
    const res = await call('POST', '/api/v1/category-rules/preview', { categoryId: coffee, conditions: [] })
    expect(res.statusCode).toBe(400)
  })

  it('does not see another user\'s transactions', async () => {
    expect((await call('POST', '/api/v1/category-rules/preview', {
      categoryId: theirCategory, conditions: [contains('zzforeign')], applyToExisting: true,
    }, other)).json()).toEqual({ wouldCategorize: 1, wouldRecategorize: 0 })
    expect((await call('POST', '/api/v1/category-rules/preview', {
      categoryId: coffee, conditions: [contains('zzforeign')], applyToExisting: true,
    })).json()).toEqual({ wouldCategorize: 0, wouldRecategorize: 0 })
  })
})

describe('deleting a rule', () => {
  it('responds 204 and removes the rule with its conditions', async () => {
    const { rule } = await createRule({
      categoryId: coffee, conditions: [contains('zz-delete-a'), contains('zz-delete-b')],
    })

    const res = await call('DELETE', `/api/v1/category-rules/${rule.id}`)

    expect(res.statusCode).toBe(204)
    expect(((await call('GET', '/api/v1/category-rules')).json() as Rule[]).some((r) => r.id === rule.id)).toBe(false)
    const orphans = await asUser(h.db, user.id, (trx) =>
      sql<{ n: string }>`SELECT count(*) AS n FROM core.category_rule_conditions WHERE rule_id = ${rule.id}`.execute(trx),
    )
    expect(Number(orphans.rows[0]?.n)).toBe(0)
  })

  it('keeps transactions the rule already categorized', async () => {
    await seed('ZZKEEP', 2)
    const { rule } = await createRule({ categoryId: coffee, conditions: [contains('zzkeep')] })

    await call('DELETE', `/api/v1/category-rules/${rule.id}`)

    expect(await tally('ZZKEEP%')).toEqual({ [`${coffee}/rule`]: 2 })
  })

  it('404s for an unknown rule, and a second delete', async () => {
    const { rule } = await createRule({ categoryId: coffee, conditions: [contains('zz-twice')] })
    expect((await call('DELETE', `/api/v1/category-rules/${ABSENT}`)).statusCode).toBe(404)
    expect((await call('DELETE', `/api/v1/category-rules/${rule.id}`)).statusCode).toBe(204)
    expect((await call('DELETE', `/api/v1/category-rules/${rule.id}`)).statusCode).toBe(404)
  })

  it("404s for another user's rule and leaves it in place", async () => {
    const { rule } = await createRule({ categoryId: coffee, conditions: [contains('zz-cross-user')] })

    const res = await call('DELETE', `/api/v1/category-rules/${rule.id}`, undefined, other)

    expect(res.statusCode).toBe(404)
    expect(res.json()).toMatchObject({ code: 'not_found' })
    expect(((await call('GET', '/api/v1/category-rules')).json() as Rule[]).some((r) => r.id === rule.id)).toBe(true)
  })

  it('400s on an id that is not a UUID', async () => {
    expect((await call('DELETE', '/api/v1/category-rules/not-a-uuid')).statusCode).toBe(400)
  })
})

describe('validating a rule body', () => {
  const rejected = async (conditions: unknown, extra: Record<string, unknown> = {}) => {
    const body = { categoryId: coffee, conditions, ...extra }
    const create = await call('POST', '/api/v1/category-rules', body)
    const preview = await call('POST', '/api/v1/category-rules/preview', body)
    expect(preview.statusCode).toBe(create.statusCode)
    return create
  }

  it('rejects an amount_range with neither bound', async () => {
    const res = await rejected([{ conditionType: 'amount_range', direction: 'out' }])
    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({ code: 'validation_failed' })
    expect((res.json() as { message: string }).message).toBe('conditions.0.amountMin: Set a minimum, a maximum, or both.')
    expect(res.json()).toMatchObject({
      issues: [{ path: ['conditions', 0, 'amountMin'], message: 'Set a minimum, a maximum, or both.' }],
    })
  })

  it('refuses "at least 0" on the field it came from, with a sentence that says what to do instead', async () => {
    const res = await rejected([{ conditionType: 'amount_range', direction: 'out', amountMin: '0', amountMax: '50' }])

    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({
      code: 'validation_failed',
      // The top-level message keeps its `path: message` form for older clients.
      message: 'conditions.0.amountMin: Must be more than 0. Leave it empty for no minimum.',
      issues: [{ path: ['conditions', 0, 'amountMin'], message: 'Must be more than 0. Leave it empty for no minimum.' }],
    })
  })

  it('reports every bad field at once, each on its own path', async () => {
    const res = await rejected(
      [
        { conditionType: 'merchant_contains', textValue: '   ' },
        { conditionType: 'amount_exact', direction: 'out', amountValue: '1.23456' },
      ],
      { priority: 1.5 },
    )

    expect(res.statusCode).toBe(400)
    expect((res.json() as { issues: unknown[] }).issues).toEqual([
      { path: ['priority'], message: 'Must be a whole number.' },
      { path: ['conditions', 0, 'textValue'], message: 'This cannot be empty.' },
      { path: ['conditions', 1, 'amountValue'], message: 'Enter an amount like 12.50, with no more than 4 decimal places.' },
    ])
  })

  it('rejects an amount_range with both bounds explicitly null', async () => {
    expect((await rejected([{ conditionType: 'amount_range', direction: 'in', amountMin: null, amountMax: null }])).statusCode).toBe(400)
  })

  it('rejects min greater than max, but accepts min equal to max', async () => {
    const bad = await rejected([{ conditionType: 'amount_range', direction: 'out', amountMin: '20', amountMax: '10' }])
    expect(bad.statusCode).toBe(400)
    expect(bad.json()).toMatchObject({
      issues: [{ path: ['conditions', 0, 'amountMax'], message: 'Cannot be less than the minimum.' }],
    })

    const ok = await call('POST', '/api/v1/category-rules', {
      categoryId: coffee, conditions: [{ conditionType: 'amount_range', direction: 'out', amountMin: '10', amountMax: '10.00' }],
    })
    expect(ok.statusCode).toBe(201)
  })

  it('compares the bounds numerically, not as text', async () => {
    const ok = await call('POST', '/api/v1/category-rules', {
      categoryId: coffee, conditions: [{ conditionType: 'amount_range', direction: 'out', amountMin: '9', amountMax: '10' }],
    })
    expect(ok.statusCode).toBe(201)
  })

  it('rejects empty and missing conditions', async () => {
    const empty = await rejected([])
    expect(empty.statusCode).toBe(400)
    expect((empty.json() as { message: string }).message).toContain('A rule needs at least one condition.')
    expect((await call('POST', '/api/v1/category-rules', { categoryId: coffee })).statusCode).toBe(400)
  })

  it.each([
    ['a blank text value', [{ conditionType: 'merchant_exact', textValue: '   ' }]],
    ['an unknown condition type', [{ conditionType: 'merchant_regex', textValue: 'x' }]],
    ['a zero exact amount', [{ conditionType: 'amount_exact', direction: 'out', amountValue: '0' }]],
    ['a negative exact amount', [{ conditionType: 'amount_exact', direction: 'out', amountValue: '-5' }]],
    ['too many decimals', [{ conditionType: 'amount_exact', direction: 'out', amountValue: '1.23456' }]],
    ['a missing direction', [{ conditionType: 'amount_exact', amountValue: '5' }]],
    ['a bad direction', [{ conditionType: 'amount_exact', direction: 'sideways', amountValue: '5' }]],
    ['a negative range bound', [{ conditionType: 'amount_range', direction: 'out', amountMin: '-1' }]],
  ])('rejects %s', async (_name, conditions) => {
    expect((await rejected(conditions)).statusCode).toBe(400)
  })

  it('rejects a non-UUID category and a non-integer priority', async () => {
    expect((await call('POST', '/api/v1/category-rules', { categoryId: 'nope', conditions: [contains('x')] })).statusCode).toBe(400)
    expect((await rejected([contains('x')], { priority: 1.5 })).statusCode).toBe(400)
  })
})

describe('what each condition type stores', () => {
  const stored = async (condition: Record<string, unknown>): Promise<RuleCondition> => {
    const { rule } = await createRule({ categoryId: coffee, conditions: [condition] })
    return rule.conditions[0] as RuleCondition
  }

  it('stores text conditions with no amount columns', async () => {
    for (const type of ['merchant_exact', 'merchant_contains', 'description_contains']) {
      expect(await stored({ conditionType: type, textValue: `zz-${type}`, isCaseSensitive: true })).toMatchObject({
        condition_type: type, text_value: `zz-${type}`, is_case_sensitive: true,
        direction: null, amount_value: null, amount_min: null, amount_max: null,
      })
    }
  })

  it('trims text and defaults case sensitivity to false', async () => {
    expect(await stored({ conditionType: 'merchant_exact', textValue: '  zz-trim  ' })).toMatchObject({
      text_value: 'zz-trim', is_case_sensitive: false,
    })
  })

  it('stores amount_exact as a positive magnitude and a direction', async () => {
    expect(await stored({ conditionType: 'amount_exact', direction: 'out', amountValue: '375' })).toMatchObject({
      condition_type: 'amount_exact', direction: 'out', amount_value: '375.0000',
      text_value: null, amount_min: null, amount_max: null, is_case_sensitive: false,
    })
  })

  it('stores amount_range bounds, leaving an omitted one null', async () => {
    expect(await stored({ conditionType: 'amount_range', direction: 'in', amountMin: '1.5', amountMax: 9 })).toMatchObject({
      condition_type: 'amount_range', direction: 'in', amount_min: '1.5000', amount_max: '9.0000',
      text_value: null, amount_value: null,
    })
    expect(await stored({ conditionType: 'amount_range', direction: 'out', amountMin: '500' })).toMatchObject({
      amount_min: '500.0000', amount_max: null,
    })
    expect(await stored({ conditionType: 'amount_range', direction: 'out', amountMax: '20' })).toMatchObject({
      amount_min: null, amount_max: '20.0000',
    })
  })

  it('applies stored amount conditions by direction and magnitude', async () => {
    await seed('ZZAMT OUT', 1, { amount: '-375.0000' })
    await seed('ZZAMT IN', 1, { amount: '375.0000' })

    const r = await createRule({
      categoryId: coffee, conditions: [{ conditionType: 'amount_exact', direction: 'out', amountValue: '375' }],
    })

    expect(r.recategorized).toBeGreaterThanOrEqual(1)
    expect(await tally('ZZAMT OUT%')).toEqual({ [`${coffee}/rule`]: 1 })
    expect(await tally('ZZAMT IN%')).toEqual({ 'none/none': 1 })
  })
})

describe('starter categories and usage across users', () => {
  it("keeps one user's starter run away from another's categories", async () => {
    const a = await createUser(h)
    const b = await createUser(h)

    const first = await call('POST', '/api/v1/categories/starter', { situations: ['always'] }, a)
    expect(first.statusCode).toBe(200)
    expect((first.json() as { created: number }).created).toBeGreaterThan(0)

    expect(((await call('GET', '/api/v1/categories', undefined, b)).json() as unknown[])).toEqual([])
    const second = await call('POST', '/api/v1/categories/starter', { situations: ['always'] }, b)
    expect((second.json() as { skipped: number }).skipped).toBe(0)
    expect((second.json() as { created: number }).created).toBe((first.json() as { created: number }).created)
  })

  it('rejects an unknown situation and an empty list', async () => {
    expect((await call('POST', '/api/v1/categories/starter', { situations: ['nonsense'] })).statusCode).toBe(400)
    expect((await call('POST', '/api/v1/categories/starter', { situations: [] })).statusCode).toBe(400)
  })

  it("reveals nothing about another user's category through usage", async () => {
    await call('POST', '/api/v1/transactions', {
      accountId, merchant: 'X', amount: '-1', transactionDate: '2026-01-01', categoryId: coffee,
    })
    await createRule({ categoryId: coffee, conditions: [contains('zz-usage-leak')] })

    const mine = (await call('GET', `/api/v1/categories/${coffee}/usage`)).json() as { total: number }
    const theirs = await call('GET', `/api/v1/categories/${coffee}/usage`, undefined, other)

    expect(mine.total).toBeGreaterThan(0)
    // Either "not found" or an all-zero answer is safe; any count would leak.
    if (theirs.statusCode === 200) {
      expect(theirs.json()).toMatchObject({ total: 0, by: [], childCount: 0 })
    } else {
      expect(theirs.statusCode).toBe(404)
    }
  })

  it("cannot delete or use another user's category for a rule via the starter/usage ids", async () => {
    expect((await call('DELETE', `/api/v1/categories/${coffee}`, undefined, other)).statusCode).toBe(404)
    expect((await call('GET', '/api/v1/categories/not-a-uuid/usage')).statusCode).toBe(400)
  })
})

describe('a rule spanning far more uncategorized transactions than one page', () => {
  it('applies to every one of them (regression: 65,535 bind-parameter limit)', async () => {
    const total = 70_000
    const started = Date.now()
    await seed('ZZBULK COFFEE', total)
    await seed('ZZBULK OTHER', 50)
    await seed('ZZBULK MANUAL COFFEE', 10, { categoryId: dining, source: 'manual' })

    const res = await call('POST', '/api/v1/category-rules', {
      categoryId: coffee, conditions: [contains('zzbulk coffee')],
    })

    expect(res.statusCode).toBe(201)
    expect((res.json() as { recategorized: number }).recategorized).toBe(total)
    expect(await tally('ZZBULK%')).toEqual({
      [`${coffee}/rule`]: total,
      'none/none': 50,
      [`${dining}/manual`]: 10,
    })
    expect(Date.now() - started).toBeLessThan(25_000)
  }, 60_000)
})
