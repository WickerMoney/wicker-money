import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { auth, createHarness, createUser, type Harness, type TestUser } from '../testing/harness.js'
import { SITUATION_GROUPS } from '../categories/catalog.js'

let h: Harness

async function get<T>(url: string, u: TestUser): Promise<T> {
  const res = await h.app.inject({ method: 'GET', url, headers: auth(u) })
  return res.json() as T
}

async function post<T>(url: string, payload: unknown, u: TestUser): Promise<T> {
  const res = await h.app.inject({ method: 'POST', url, headers: auth(u), payload })
  return res.json() as T
}

interface Status {
  onboardedAt: string | null
  situations: string[]
  categoryCount: number
  groups: typeof SITUATION_GROUPS
}

async function categorySlugs(u: TestUser): Promise<string[]> {
  const rows = await get<Array<{ slug: string }>>('/api/v1/categories', u)
  return rows.map((r) => r.slug)
}

beforeAll(async () => { h = await createHarness() })
afterAll(async () => { await h.close() })

describe('first run', () => {
  it('reports a brand new account as not yet set up, with the questions to ask', async () => {
    const user = await createUser(h)
    const status = await get<Status>('/api/v1/onboarding', user)

    expect(status.onboardedAt).toBeNull()
    expect(status.categoryCount).toBe(0)
    // The UI renders exactly what this returns. Shipping the questions from the
    // server is what stops the wizard and the catalog drifting apart.
    expect(status.groups.length).toBe(SITUATION_GROUPS.length)
    expect(status.groups[0]?.questions.length).toBeGreaterThan(0)
  })

  it('counts what an answer would create without creating anything', async () => {
    const user = await createUser(h)

    const base = await post<{ total: number }>('/api/v1/onboarding/preview', { situations: [] }, user)
    const withPets = await post<{ total: number; slugs: string[] }>(
      '/api/v1/onboarding/preview', { situations: ['pets'] }, user,
    )

    expect(withPets.total).toBeGreaterThan(base.total)
    expect(withPets.slugs).toContain('veterinarian')
    // Nothing was written — this is the number shown while the user is still
    // deciding.
    expect(await categorySlugs(user)).toEqual([])
  })
})

describe('completing setup', () => {
  it('creates the base set even when every question is declined', async () => {
    const user = await createUser(h)

    const r = await post<{ created: number }>('/api/v1/onboarding/complete', { situations: [] }, user)

    expect(r.created).toBeGreaterThan(40)
    const slugs = await categorySlugs(user)
    expect(slugs).toContain('groceries')
    // Declining everything must not mean an empty dropdown; 'always' is not a
    // question.
    expect(slugs).not.toContain('veterinarian')
  })

  it('adds the branches behind the answers', async () => {
    const user = await createUser(h)
    await post('/api/v1/onboarding/complete', { situations: ['pets', 'kids-school'] }, user)

    const slugs = await categorySlugs(user)
    expect(slugs).toContain('veterinarian')
    expect(slugs).toContain('school-supplies')
    // kids-school, not kids-young: the split is the point of the finer questions.
    expect(slugs).not.toContain('daycare')
  })

  it('marks the account as set up and remembers the answers', async () => {
    const user = await createUser(h)
    await post('/api/v1/onboarding/complete', { situations: ['pets'] }, user)

    const status = await get<Status>('/api/v1/onboarding', user)
    expect(status.onboardedAt).not.toBeNull()
    expect(status.situations).toContain('pets')
    // 'always' is recorded too, so the stored answers are the exact input to
    // selectForSituations rather than a set that needs reassembling.
    expect(status.situations).toContain('always')
  })

  it('adds only what is missing when run again with more answers', async () => {
    const user = await createUser(h)
    const first = await post<{ created: number }>('/api/v1/onboarding/complete', { situations: [] }, user)
    const second = await post<{ created: number; skipped: number }>(
      '/api/v1/onboarding/complete', { situations: ['pets'] }, user,
    )

    expect(second.skipped).toBe(first.created)
    // Six pet children plus the Pets parent.
    expect(second.created).toBe(7)
  })

  it('refuses a situation it does not recognise rather than silently ignoring it', async () => {
    const user = await createUser(h)
    const res = await h.app.inject({
      method: 'POST', url: '/api/v1/onboarding/complete', headers: auth(user),
      payload: { situations: ['owns-a-yacht'] },
    })
    // Ignoring it would create the base set, report success, and leave the user
    // wondering where their categories went.
    expect(res.statusCode).toBe(400)
  })

  it('requires authentication', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/onboarding' })
    expect(res.statusCode).toBe(401)
  })
})

describe('resetting setup', () => {
  it('clears the flag and keeps the categories by default', async () => {
    const user = await createUser(h)
    await post('/api/v1/onboarding/complete', { situations: ['pets'] }, user)
    const before = (await categorySlugs(user)).length

    const r = await post<{ removed: number }>('/api/v1/onboarding/reset', {}, user)

    expect(r.removed).toBe(0)
    expect((await categorySlugs(user)).length).toBe(before)
    const status = await get<Status>('/api/v1/onboarding', user)
    expect(status.onboardedAt).toBeNull()
    expect(status.situations).toEqual([])
  })

  it('adds new catalog entries on "Run setup again" without touching what is there', async () => {
    // An account set up before Memberships and Domains / web hosting were in
    // the catalog: build it by running setup and deleting those two.
    const user = await createUser(h)
    await post('/api/v1/onboarding/complete', { situations: ['tech'] }, user)
    const cats = await get<Array<{ id: string; slug: string; name: string }>>('/api/v1/categories', user)
    for (const slug of ['memberships', 'domains-web-hosting']) {
      const c = cats.find((x) => x.slug === slug)
      expect(c).toBeDefined()
      const del = await h.app.inject({ method: 'DELETE', url: `/api/v1/categories/${c?.id}`, headers: auth(user) })
      expect(del.statusCode).toBe(204)
    }
    const groceries = cats.find((x) => x.slug === 'groceries')
    const renamed = await h.app.inject({
      method: 'PATCH', url: `/api/v1/categories/${groceries?.id}`, headers: auth(user),
      payload: { name: 'Food shopping' },
    })
    expect(renamed.statusCode).toBe(200)
    const before = await categorySlugs(user)

    // What the Categories page does: reset with "remove unused" unticked,
    // then finish the wizard again.
    const reset = await post<{ removed: number }>('/api/v1/onboarding/reset', {}, user)
    expect(reset.removed).toBe(0)
    const again = await post<{ created: number; skipped: number }>(
      '/api/v1/onboarding/complete', { situations: ['tech'] }, user,
    )

    expect(again.created).toBe(2)
    expect(again.skipped).toBe(before.length)
    const after = await categorySlugs(user)
    expect(after.filter((s) => !before.includes(s)).sort()).toEqual(['domains-web-hosting', 'memberships'])
    const rows = await get<Array<{ slug: string; name: string }>>('/api/v1/categories', user)
    expect(rows.find((r) => r.slug === 'groceries')?.name).toBe('Food shopping')
  })

  it('removes the starter categories when asked, for a clean re-run', async () => {
    const user = await createUser(h)
    await post('/api/v1/onboarding/complete', { situations: ['pets'] }, user)

    const r = await post<{ removed: number; kept: string[] }>(
      '/api/v1/onboarding/reset', { removeCategories: true }, user,
    )

    expect(r.removed).toBeGreaterThan(40)
    expect(r.kept).toEqual([])
    expect(await categorySlugs(user)).toEqual([])
  })

  it('never removes a category the user invented', async () => {
    const user = await createUser(h)
    await post('/api/v1/onboarding/complete', { situations: [] }, user)
    await post('/api/v1/categories', { name: 'Boat fuel', slug: 'boat-fuel' }, user)

    await post('/api/v1/onboarding/reset', { removeCategories: true }, user)

    // Only catalog slugs are eligible. Anything hand-made is not a starter
    // category no matter how the account got into this state.
    expect(await categorySlugs(user)).toEqual(['boat-fuel'])
  })

  it('keeps a category that transactions are filed under, and says which', async () => {
    const user = await createUser(h)
    await post('/api/v1/onboarding/complete', { situations: [] }, user)

    const account = await post<{ id: string }>(
      '/api/v1/accounts',
      { name: 'Everyday', accountType: 'checking', openingBalance: '0.00' },
      user,
    )
    const cats = await get<Array<{ id: string; slug: string }>>('/api/v1/categories', user)
    const groceries = cats.find((c) => c.slug === 'groceries')
    expect(groceries).toBeDefined()

    const txn = await post<{ id: string }>(
      '/api/v1/transactions',
      { accountId: account.id, merchant: 'MARKET', amount: '-20.00', transactionDate: '2026-03-04' },
      user,
    )
    await post('/api/v1/transactions/categorize', { transactionIds: [txn.id], categoryId: groceries?.id }, user)

    const r = await post<{ removed: number; kept: string[] }>(
      '/api/v1/onboarding/reset', { removeCategories: true }, user,
    )

    // ON DELETE RESTRICT would have refused this anyway; reporting it as kept
    // is the difference between an explanation and a 500.
    expect(r.kept).toContain('Groceries')
    const left = await categorySlugs(user)
    expect(left).toContain('groceries')
    // The parent survives because its child does.
    expect(left).toContain('food')
    expect(r.removed).toBeGreaterThan(0)
  })

  it('leaves another user\'s setup completely alone', async () => {
    const mine = await createUser(h)
    const theirs = await createUser(h)
    await post('/api/v1/onboarding/complete', { situations: ['pets'] }, mine)
    await post('/api/v1/onboarding/complete', { situations: ['pets'] }, theirs)

    await post('/api/v1/onboarding/reset', { removeCategories: true }, mine)

    expect(await categorySlugs(mine)).toEqual([])
    expect((await categorySlugs(theirs)).length).toBeGreaterThan(40)
    expect((await get<Status>('/api/v1/onboarding', theirs)).onboardedAt).not.toBeNull()
  })
})
