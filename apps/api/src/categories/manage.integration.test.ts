import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { auth, createHarness, createUser, type Harness, type TestUser } from '../testing/harness.js'
import { asUser } from '../db/client.js'

let h: Harness
let user: TestUser
let other: TestUser
let accountId: string

const asPluginHeaders = (u: TestUser, id: string) => ({ ...auth(u), 'x-wickermoney-plugin': id })

interface Category {
  id: string
  name: string
  slug: string
  parent_id: string | null
  is_enabled: boolean
}

async function newCategory(
  name: string, slug: string, parentId?: string | null, u = user,
): Promise<Category> {
  const res = await h.app.inject({
    method: 'POST', url: '/api/v1/categories', headers: auth(u),
    payload: { name, slug, ...(parentId === undefined ? {} : { parentId }) },
  })
  if (res.statusCode !== 201) throw new Error(`create failed: ${res.statusCode} ${res.body}`)
  return res.json() as Category
}

async function patch(id: string, payload: unknown, u = user) {
  return h.app.inject({ method: 'PATCH', url: `/api/v1/categories/${id}`, headers: auth(u), payload })
}

async function list(u = user): Promise<Category[]> {
  const res = await h.app.inject({ method: 'GET', url: '/api/v1/categories', headers: auth(u) })
  return res.json() as Category[]
}

beforeAll(async () => {
  h = await createHarness()
  const { seedBundledPlugins } = await import('../plugins/registry.js')
  await seedBundledPlugins(h.db)
  user = await createUser(h)
  other = await createUser(h)
  const acc = await h.app.inject({
    method: 'POST', url: '/api/v1/accounts', headers: auth(user),
    payload: { name: 'Everyday', accountType: 'checking', openingBalance: '0.00' },
  })
  accountId = (acc.json() as { id: string }).id
})
afterAll(async () => { await h.close() })

describe('editing a category', () => {
  it('renames without touching the slug', async () => {
    const c = await newCategory('Groceries', 'groceries')

    const res = await patch(c.id, { name: 'Food shopping' })

    expect(res.statusCode).toBe(200)
    const updated = res.json() as Category
    expect(updated.name).toBe('Food shopping')
    // The slug is the catalog's join key. Renaming it would make the next
    // starter run create a second Groceries beside this one.
    expect(updated.slug).toBe('groceries')
  })

  it('moves a category under a parent and back to the top', async () => {
    const parent = await newCategory('Food', 'food')
    const child = await newCategory('Snacks', 'snacks')

    await patch(child.id, { parentId: parent.id })
    expect((await list()).find((c) => c.id === child.id)?.parent_id).toBe(parent.id)

    await patch(child.id, { parentId: null })
    expect((await list()).find((c) => c.id === child.id)?.parent_id).toBeNull()
  })

  it('refuses a third level, on create and on move', async () => {
    const top = await newCategory('Travel', 'travel')
    const mid = await newCategory('Flights', 'flights', top.id)

    const created = await h.app.inject({
      method: 'POST', url: '/api/v1/categories', headers: auth(user),
      payload: { name: 'Baggage', slug: 'baggage', parentId: mid.id },
    })
    // A grandchild is a category the grouped pickers cannot render, so they
    // would silently drop it — worse than refusing it here.
    expect(created.statusCode).toBe(400)

    const spare = await newCategory('Seats', 'seats')
    expect((await patch(spare.id, { parentId: mid.id })).statusCode).toBe(400)
  })

  it('refuses to make a category its own parent', async () => {
    const c = await newCategory('Loop', 'loop')
    expect((await patch(c.id, { parentId: c.id })).statusCode).toBe(400)
  })

  it('refuses to move a parent that has children of its own', async () => {
    const top = await newCategory('Utilities', 'utilities')
    await newCategory('Water', 'water', top.id)
    const elsewhere = await newCategory('Home', 'home')

    // Allowing it would push Water to the third level without anyone asking.
    expect((await patch(top.id, { parentId: elsewhere.id })).statusCode).toBe(400)
  })

  it('refuses an empty patch rather than reporting a no-op as success', async () => {
    const c = await newCategory('Empty', 'empty')
    expect((await patch(c.id, {})).statusCode).toBe(400)
  })

  it('will not edit another user\'s category', async () => {
    const mine = await newCategory('Private', 'private')
    // Row-level security hides the row, so it reads as absent rather than
    // forbidden — which is the correct thing for the other user to be told.
    expect((await patch(mine.id, { name: 'Theirs' }, other)).statusCode).toBe(404)
  })
})

describe('disabling a category', () => {
  it('keeps it in the management list but out of the pickers', async () => {
    const c = await newCategory('Retired', 'retired')

    await patch(c.id, { isEnabled: false })

    expect((await list()).some((x) => x.id === c.id)).toBe(true)

    const picker = await h.app.inject({
      method: 'GET', url: '/api/v1/core/categories/list',
      headers: asPluginHeaders(user, 'wickermoney.budgets'),
    })
    expect((picker.json() as Category[]).some((x) => x.id === c.id)).toBe(false)
  })

  it('tells a picker each category\'s kind', async () => {
    const c = await newCategory('Side gig', 'side-gig')
    const picker = await h.app.inject({
      method: 'GET', url: '/api/v1/core/categories/list',
      headers: asPluginHeaders(user, 'wickermoney.budgets'),
    })
    const row = (picker.json() as Array<Record<string, unknown>>).find((x) => x['id'] === c.id)
    // Exactly these keys: the picker endpoint stays a narrow projection.
    expect(Object.keys(row ?? {}).sort()).toEqual(['id', 'kind', 'name', 'parent_id'])
    expect(row?.['kind']).toBe('expense')
  })

  it('takes its children with it', async () => {
    const parent = await newCategory('Hobbies', 'hobbies')
    const child = await newCategory('Model trains', 'model-trains', parent.id)

    await patch(parent.id, { isEnabled: false })

    // A parent hidden from every picker while its children stay visible is a
    // list with orphans in it, which reads as a bug rather than a choice.
    expect((await list()).find((c) => c.id === child.id)?.is_enabled).toBe(false)
  })

  it('leaves transactions already filed under it alone', async () => {
    const c = await newCategory('Old habit', 'old-habit')
    const txn = await h.app.inject({
      method: 'POST', url: '/api/v1/transactions', headers: auth(user),
      payload: {
        accountId, merchant: 'SHOP', amount: '-10.00',
        transactionDate: '2026-05-04', categoryId: c.id,
      },
    })
    const id = (txn.json() as { id: string }).id

    await patch(c.id, { isEnabled: false })

    const still = await asUser(h.db, user.id, async (trx) => {
      const r = await sql<{ category_id: string | null }>`
        SELECT category_id FROM core.transactions WHERE id = ${id}
      `.execute(trx)
      return r.rows[0]?.category_id
    })
    // Disabling is about what gets offered next, never about rewriting what
    // already happened.
    expect(still).toBe(c.id)
  })

  it('can be re-enabled', async () => {
    const c = await newCategory('Seasonal', 'seasonal')
    await patch(c.id, { isEnabled: false })
    await patch(c.id, { isEnabled: true })
    expect((await list()).find((x) => x.id === c.id)?.is_enabled).toBe(true)
  })
})

describe('deleting a category', () => {
  const del = (id: string, u = user) =>
    h.app.inject({ method: 'DELETE', url: `/api/v1/categories/${id}`, headers: auth(u) })

  it('removes one that nothing points at', async () => {
    const c = await newCategory('Typo', 'typo')

    expect((await del(c.id)).statusCode).toBe(204)
    expect((await list()).some((x) => x.id === c.id)).toBe(false)
  })

  it('REFUSES one a transaction uses, and says what is holding it', async () => {
    const c = await newCategory('In use', 'in-use')
    await h.app.inject({
      method: 'POST', url: '/api/v1/transactions', headers: auth(user),
      payload: {
        accountId, merchant: 'SHOP', amount: '-12.00',
        transactionDate: '2026-05-05', categoryId: c.id,
      },
    })

    const res = await del(c.id)

    expect(res.statusCode).toBe(409)
    const body = res.json() as { code: string; message: string }
    expect(body.code).toBe('category_in_use')
    // Without this check the foreign key rejects it and the user is shown
    // "violates foreign key constraint fk_transactions_category_id_owned",
    // which is true and useless.
    expect(body.message).toContain('1 transaction')
    expect(body.message).toContain('Disable it instead')
  })

  it('REFUSES one a rule uses', async () => {
    const c = await newCategory('Ruled', 'ruled')
    await h.app.inject({
      method: 'POST', url: '/api/v1/category-rules', headers: auth(user),
      payload: {
        categoryId: c.id,
        priority: 0,
        conditions: [{ conditionType: 'merchant_contains', textValue: 'X' }],
      },
    })

    const res = await del(c.id)
    expect(res.statusCode).toBe(409)
    expect((res.json() as { message: string }).message).toContain('rule')
  })

  it('REFUSES a parent that still has children', async () => {
    const parent = await newCategory('Keeps kids', 'keeps-kids')
    await newCategory('A child', 'a-child', parent.id)

    const res = await del(parent.id)
    expect(res.statusCode).toBe(409)
    expect((res.json() as { message: string }).message).toContain('child')
  })

  it('REFUSES one a budget line uses, without core knowing budgets exist', async () => {
    const c = await newCategory('Budgeted', 'budgeted')
    const put = await h.app.inject({
      method: 'PUT', url: '/api/v1/p/wickermoney.budgets/line',
      headers: asPluginHeaders(user, 'wickermoney.budgets'),
      payload: { month: '2026-05', categoryId: c.id, planned: '50.0000', rollover: false },
    })
    expect(put.statusCode).toBe(200)

    const res = await del(c.id)

    // The referencing tables are discovered from pg_constraint, not from a
    // hardcoded list, so a plugin's own foreign key is counted without core
    // carrying any knowledge of that plugin's schema.
    expect(res.statusCode).toBe(409)
    expect((res.json() as { message: string }).message).toContain('budget line')
  })

  it('reports usage before anyone presses the button', async () => {
    const c = await newCategory('Checkable', 'checkable')
    await h.app.inject({
      method: 'POST', url: '/api/v1/transactions', headers: auth(user),
      payload: {
        accountId, merchant: 'SHOP', amount: '-3.00',
        transactionDate: '2026-05-06', categoryId: c.id,
      },
    })

    const res = await h.app.inject({
      method: 'GET', url: `/api/v1/categories/${c.id}/usage`, headers: auth(user),
    })

    const usage = res.json() as { total: number; by: { table: string; count: number }[] }
    expect(usage.total).toBe(1)
    expect(usage.by).toContainEqual({ table: 'core.transactions', count: 1 })
  })

  it('reports zero usage for a fresh category', async () => {
    const c = await newCategory('Untouched', 'untouched')
    const res = await h.app.inject({
      method: 'GET', url: `/api/v1/categories/${c.id}/usage`, headers: auth(user),
    })
    const usage = res.json() as { total: number; unreadable: string[] }
    expect(usage.total).toBe(0)
    // Nothing should be uncountable from the application's own connection; a
    // non-empty list here means a later plugin added a reference this cannot
    // see, and "I could not check" must not read as "nothing uses it".
    expect(usage.unreadable).toEqual([])
  })

  it('404s on another user\'s category rather than deleting it', async () => {
    const mine = await newCategory('Mine alone', 'mine-alone')
    expect((await del(mine.id, other)).statusCode).toBe(404)
    expect((await list()).some((x) => x.id === mine.id)).toBe(true)
  })
})
