import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { auth, createHarness, createUser, type Harness, type TestUser } from '../testing/harness.js'

let h: Harness
let user: TestUser
let accountId: string
let groceries: string
let dining: string

beforeAll(async () => {
  h = await createHarness()
  user = await createUser(h)

  const account = await h.app.inject({
    method: 'POST', url: '/api/v1/accounts', headers: auth(user),
    payload: { name: 'Ledger', accountType: 'checking', initialBalance: '0' },
  })
  accountId = account.json().id

  const mkCat = async (name: string, slug: string) => {
    const r = await h.app.inject({
      method: 'POST', url: '/api/v1/categories', headers: auth(user),
      payload: { name, slug },
    })
    return r.json().id as string
  }
  groceries = await mkCat('Groceries', 'groceries')
  dining = await mkCat('Dining', 'dining')
})
afterAll(async () => { await h.close() })

const tx = (over: Record<string, unknown> = {}) => ({
  accountId, amount: '-10.00', merchant: 'Corner Shop',
  transactionDate: '2026-03-15', ...over,
})

describe('transactions', () => {
  it('records a transaction', async () => {
    const res = await h.app.inject({
      method: 'POST', url: '/api/v1/transactions', headers: auth(user), payload: tx(),
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().amount).toBe('-10.0000')
    expect(res.json().category_source).toBeNull()
  })

  it('preserves precision that a float would lose', async () => {
    const res = await h.app.inject({
      method: 'POST', url: '/api/v1/transactions', headers: auth(user),
      payload: tx({ amount: '-12345678901.1234', merchant: 'Big' }),
    })
    expect(res.json().amount).toBe('-12345678901.1234')
  })

  it('rejects more than four decimal places', async () => {
    const res = await h.app.inject({
      method: 'POST', url: '/api/v1/transactions', headers: auth(user),
      payload: tx({ amount: '-10.000001' }),
    })
    expect(res.statusCode).toBe(400)
  })

  it('refuses to record a transfer through the ordinary create path', async () => {
    const res = await h.app.inject({
      method: 'POST', url: '/api/v1/transactions', headers: auth(user),
      payload: tx({ transferAccountId: accountId }),
    })

    // A check constraint would reject this with a 500 — correct, and useless to
    // read. A transfer is two rows and this endpoint writes one, so it must say
    // so and name the endpoint that writes both.
    expect(res.statusCode).toBe(400)
    expect((res.json() as { message: string }).message).toContain('/transactions/transfer')
  })

  it('refuses to turn an existing transaction into a transfer by editing it', async () => {
    const created = await h.app.inject({
      method: 'POST', url: '/api/v1/transactions', headers: auth(user), payload: tx({}),
    })
    const id = (created.json() as { id: string }).id

    const res = await h.app.inject({
      method: 'PATCH', url: `/api/v1/transactions/${id}`, headers: auth(user),
      payload: { transferAccountId: accountId },
    })

    // Flipping the field on one row would leave the other leg unwritten: money
    // leaving one account and arriving nowhere.
    expect(res.statusCode).toBe(400)
  })

  it('refuses a duplicate external id on the same account', async () => {
    const payload = tx({ externalId: 'bank-ref-0001', merchant: 'Dedupe' })
    const first = await h.app.inject({
      method: 'POST', url: '/api/v1/transactions', headers: auth(user), payload,
    })
    expect(first.statusCode).toBe(201)

    const second = await h.app.inject({
      method: 'POST', url: '/api/v1/transactions', headers: auth(user), payload,
    })
    expect(second.statusCode).toBe(409)
    expect(second.json().code).toBe('duplicate_external_id')
  })
})

describe('listing', () => {
  it('filters, sorts and pages', async () => {
    const u = await createUser(h)
    const acc = (await h.app.inject({
      method: 'POST', url: '/api/v1/accounts', headers: auth(u),
      payload: { name: 'Paging', accountType: 'checking' },
    })).json()

    for (const [i, amount] of ['-1.00', '-2.00', '-3.00'].entries()) {
      await h.app.inject({
        method: 'POST', url: '/api/v1/transactions', headers: auth(u),
        payload: {
          accountId: acc.id, amount, merchant: `Shop ${i}`,
          transactionDate: `2026-01-0${i + 1}`,
        },
      })
    }

    const page = await h.app.inject({
      method: 'GET', headers: auth(u),
      url: '/api/v1/transactions?sort=date&direction=asc&limit=2&withTotal=true',
    })
    const body = page.json()
    expect(body.total).toBe(3)
    expect(body.items).toHaveLength(2)
    expect(body.items[0].transaction_date).toBe('2026-01-01')
    expect(body.nextCursor).toEqual(expect.any(String))

    const next = (await h.app.inject({
      method: 'GET', headers: auth(u),
      url: `/api/v1/transactions?sort=date&direction=asc&limit=2&cursor=${body.nextCursor}`,
    })).json()
    expect(next.items.map((t: { merchant: string }) => t.merchant)).toEqual(['Shop 2'])
    expect(next.nextCursor).toBeNull()
    expect(next).not.toHaveProperty('total')

    const filtered = await h.app.inject({
      method: 'GET', url: '/api/v1/transactions?search=Shop%202&withTotal=true', headers: auth(u),
    })
    expect(filtered.json().total).toBe(1)
  })
})

describe('input limits', () => {
  const create = (payload: Record<string, unknown>) =>
    h.app.inject({ method: 'POST', url: '/api/v1/transactions', headers: auth(user), payload })
  const list = (query: string) =>
    h.app.inject({ method: 'GET', url: `/api/v1/transactions?${query}`, headers: auth(user) })

  it('rejects a date that does not exist instead of failing in the database', async () => {
    for (const transactionDate of ['2026-02-31', '2026-13-01', '2025-02-29', '0000-01-01', '2026-04-31']) {
      expect((await create(tx({ transactionDate }))).statusCode, transactionDate).toBe(400)
    }
    expect((await create(tx({ transactionDate: '2028-02-29' }))).statusCode).toBe(201)
    expect((await list('from=2026-02-31')).statusCode).toBe(400)
    expect((await list('to=2026-06-31')).statusCode).toBe(400)
  })

  it('caps text fields', async () => {
    expect((await create(tx({ merchant: 'm'.repeat(301) }))).statusCode).toBe(400)
    expect((await create(tx({ notes: 'n'.repeat(1001) }))).statusCode).toBe(400)
    expect((await create(tx({ externalId: 'e'.repeat(256) }))).statusCode).toBe(400)
    expect((await list(`search=${'s'.repeat(201)}`)).statusCode).toBe(400)
  })

  it('caps the page size at 200', async () => {
    expect((await list('limit=200')).statusCode).toBe(200)
    expect((await list('limit=201')).statusCode).toBe(400)
    expect((await list('limit=0')).statusCode).toBe(400)
  })

  it('answers 400, never 500, for a bad cursor or a bad withTotal', async () => {
    const wire = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
    const id = '0b0e7d0e-7b1a-4c6e-9d59-7a3f2f1d6c11'
    for (const cursor of [
      'not-a-cursor!', wire(null), wire({ sort: 'date' }),
      wire({ sort: 'date', direction: 'desc', value: '2026-02-31', id }),
      wire({ sort: 'amount', direction: 'desc', value: 'abc', id }),
      wire({ sort: 'date', direction: 'desc', value: '2026-01-01', id: 'x' }),
      'A'.repeat(2000),
    ]) {
      const res = await list(`cursor=${encodeURIComponent(cursor)}`)
      expect(res.statusCode, cursor).toBe(400)
      expect(res.json().code).toBe('validation_failed')
    }
    expect((await list('withTotal=yes')).statusCode).toBe(400)
  })

  it('refuses a cursor issued for a different sort or direction', async () => {
    const cursor = Buffer.from(JSON.stringify({
      sort: 'date', direction: 'desc', value: '2026-01-01', id: '0b0e7d0e-7b1a-4c6e-9d59-7a3f2f1d6c11',
    })).toString('base64url')

    expect((await list(`cursor=${cursor}&sort=amount`)).statusCode).toBe(400)
    expect((await list(`cursor=${cursor}&direction=asc`)).statusCode).toBe(400)
    expect((await list(`cursor=${cursor}`)).statusCode).toBe(200)
  })

  it('ignores an offset, which is no longer a paging option', async () => {
    const res = await list('offset=3')

    expect(res.statusCode).toBe(200)
    expect(res.json()).not.toHaveProperty('offset')
  })

  it('leaves the total out unless it is asked for', async () => {
    expect(await list('limit=1').then((r) => r.json())).not.toHaveProperty('total')
    expect(typeof (await list('limit=1&withTotal=true')).json().total).toBe('number')
  })
})

describe('merchant search', () => {
  let u: TestUser

  beforeAll(async () => {
    u = await createUser(h)
    const acc = (await h.app.inject({
      method: 'POST', url: '/api/v1/accounts', headers: auth(u),
      payload: { name: 'Search', accountType: 'checking' },
    })).json()
    for (const merchant of ['50% off sale', '50X off sale', 'under_score', 'underXscore', 'back\\slash', 'plain']) {
      await h.app.inject({
        method: 'POST', url: '/api/v1/transactions', headers: auth(u),
        payload: { accountId: acc.id, amount: '-1.00', merchant, transactionDate: '2026-02-02' },
      })
    }
  })

  const search = async (term: string): Promise<string[]> => {
    const res = await h.app.inject({
      method: 'GET', url: `/api/v1/transactions?search=${encodeURIComponent(term)}&limit=200`, headers: auth(u),
    })
    return (res.json() as { items: Array<{ merchant: string }> }).items.map((t) => t.merchant).sort()
  }

  it('matches case-insensitively as a substring', async () => {
    expect(await search('PLAIN')).toEqual(['plain'])
    expect(await search('off')).toEqual(['50% off sale', '50X off sale'])
  })

  it('treats percent as a literal character, not a wildcard', async () => {
    expect(await search('%')).toEqual(['50% off sale'])
    expect(await search('50%')).toEqual(['50% off sale'])
  })

  it('treats underscore as a literal character, not a single-character wildcard', async () => {
    expect(await search('_')).toEqual(['under_score'])
    expect(await search('under_s')).toEqual(['under_score'])
  })

  it('treats a backslash as a literal character', async () => {
    expect(await search('\\')).toEqual(['back\\slash'])
  })
})

describe('auto-categorization', () => {
  it('applies a matching rule and records the source as rule', async () => {
    const u = await createUser(h)
    const acc = (await h.app.inject({
      method: 'POST', url: '/api/v1/accounts', headers: auth(u),
      payload: { name: 'Rules', accountType: 'checking' },
    })).json()
    const cat = (await h.app.inject({
      method: 'POST', url: '/api/v1/categories', headers: auth(u),
      payload: { name: 'Coffee', slug: 'coffee' },
    })).json()

    await h.app.inject({
      method: 'POST', url: '/api/v1/category-rules', headers: auth(u),
      payload: {
        categoryId: cat.id,
        conditions: [{ conditionType: 'merchant_contains', textValue: 'bottle' }],
      },
    })

    const created = await h.app.inject({
      method: 'POST', url: '/api/v1/transactions', headers: auth(u),
      payload: {
        accountId: acc.id, amount: '-4.50', merchant: 'Blue Bottle',
        transactionDate: '2026-02-02',
      },
    })
    expect(created.json().category_id).toBe(cat.id)
    expect(created.json().category_source).toBe('rule')
  })

  it('never overrides an explicit category choice', async () => {
    const res = await h.app.inject({
      method: 'POST', url: '/api/v1/transactions', headers: auth(user),
      payload: tx({ merchant: 'Corner Shop', categoryId: dining }),
    })
    expect(res.json().category_id).toBe(dining)
    expect(res.json().category_source).toBe('manual')
  })

  // An opt-in reapply of rules must not touch hand-made assignments.
  it('protects manual categorizations from a retroactive rule', async () => {
    const u = await createUser(h)
    const acc = (await h.app.inject({
      method: 'POST', url: '/api/v1/accounts', headers: auth(u),
      payload: { name: 'Protect', accountType: 'checking' },
    })).json()
    const manual = (await h.app.inject({
      method: 'POST', url: '/api/v1/categories', headers: auth(u),
      payload: { name: 'Chosen by hand', slug: 'by-hand' },
    })).json()
    const ruleCat = (await h.app.inject({
      method: 'POST', url: '/api/v1/categories', headers: auth(u),
      payload: { name: 'By rule', slug: 'by-rule' },
    })).json()

    const manualTx = (await h.app.inject({
      method: 'POST', url: '/api/v1/transactions', headers: auth(u),
      payload: {
        accountId: acc.id, amount: '-9.99', merchant: 'Ambiguous Merchant',
        transactionDate: '2026-04-04', categoryId: manual.id,
      },
    })).json()
    const autoTx = (await h.app.inject({
      method: 'POST', url: '/api/v1/transactions', headers: auth(u),
      payload: {
        accountId: acc.id, amount: '-9.99', merchant: 'Ambiguous Merchant',
        transactionDate: '2026-04-05',
      },
    })).json()

    const applied = await h.app.inject({
      method: 'POST', url: '/api/v1/category-rules', headers: auth(u),
      payload: {
        categoryId: ruleCat.id,
        applyToExisting: true,
        conditions: [{ conditionType: 'merchant_contains', textValue: 'Ambiguous' }],
      },
    })
    // Only the uncategorized one moved.
    expect(applied.json().recategorized).toBe(1)

    const after = await h.app.inject({
      method: 'GET', url: `/api/v1/transactions?accountId=${acc.id}`, headers: auth(u),
    })
    const byId = new Map(after.json().items.map((t: { id: string }) => [t.id, t]))
    expect((byId.get(manualTx.id) as { category_id: string }).category_id).toBe(manual.id)
    expect((byId.get(autoTx.id) as { category_id: string }).category_id).toBe(ruleCat.id)
  })
})

describe('splits', () => {
  it('requires the parts to sum to the parent', async () => {
    const parent = (await h.app.inject({
      method: 'POST', url: '/api/v1/transactions', headers: auth(user),
      payload: tx({ amount: '-100.00', merchant: 'Supermarket' }),
    })).json()

    const wrong = await h.app.inject({
      method: 'PUT', url: `/api/v1/transactions/${parent.id}/splits`, headers: auth(user),
      payload: { splits: [{ amount: '-60.00', categoryId: groceries }, { amount: '-30.00', categoryId: dining }] },
    })
    expect(wrong.statusCode).toBe(400)

    const right = await h.app.inject({
      method: 'PUT', url: `/api/v1/transactions/${parent.id}/splits`, headers: auth(user),
      payload: { splits: [{ amount: '-60.00', categoryId: groceries }, { amount: '-40.00', categoryId: dining }] },
    })
    expect(right.statusCode).toBe(200)
    expect(right.json()).toHaveLength(2)
  })
})
