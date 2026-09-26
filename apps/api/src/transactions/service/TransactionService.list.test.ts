import { beforeEach, describe, expect, it } from 'vitest'
import { ValidationError } from '../../errors.js'
import type { Transaction } from '../../db/models/index.js'
import type { TransactionCursor } from './TransactionCursor.js'
import type { TransactionListQuery } from './TransactionListQuery.js'
import { TransactionService } from './TransactionService.js'
import { InMemoryUnitOfWork } from './testing/InMemoryUnitOfWork.js'

const ALICE = 'user-alice'
const BOB = 'user-bob'

let uow: InMemoryUnitOfWork
let service: TransactionService

/** Dates repeat on purpose: three days, so most pages straddle a run of equal keys. */
const DATES = ['2026-03-01', '2026-03-02', '2026-03-03']

beforeEach(async () => {
  uow = new InMemoryUnitOfWork()
  service = new TransactionService(uow)
  uow.ledger.accounts.push(
    { id: 'acc-checking', userId: ALICE, name: 'Checking' },
    { id: 'acc-savings', userId: ALICE, name: 'Savings' },
    { id: 'acc-bob', userId: BOB, name: 'Bob checking' },
  )
  uow.ledger.categories.push(
    { id: 'cat-food', userId: ALICE, name: 'Food' },
    { id: 'cat-groceries', userId: ALICE, name: 'Groceries', parentId: 'cat-food' },
    { id: 'cat-fun', userId: ALICE, name: 'Fun' },
  )
  for (let i = 0; i < 23; i += 1) {
    await service.create(ALICE, {
      accountId: i % 2 === 0 ? 'acc-checking' : 'acc-savings',
      // Repeated amounts and merchants so every sort has ties too.
      amount: `-${(i % 5) + 1}.50`,
      merchant: `Shop ${i % 4}`,
      transactionDate: DATES[i % 3]!,
      categoryId: i % 6 === 0 ? 'cat-groceries' : i % 6 === 1 ? 'cat-fun' : null,
    })
  }
  await service.create(BOB, { accountId: 'acc-bob', amount: '-1.00', merchant: 'Shop 0', transactionDate: DATES[0]! })
})

const base: TransactionListQuery = { sort: 'date', direction: 'desc', limit: 5, withTotal: false }

/** Follows `nextCursor` to the end, returning every page's rows. */
async function walk(query: TransactionListQuery): Promise<Transaction[][]> {
  const pages: Transaction[][] = []
  let cursor = query.cursor
  for (let guard = 0; guard < 100; guard += 1) {
    const result = await service.list(ALICE, { ...query, cursor })
    pages.push(result.items)
    if (result.nextCursor === null) return pages
    cursor = result.nextCursor
  }
  throw new Error('paging did not terminate')
}

const ids = (pages: Transaction[][]): string[] => pages.flat().map((t) => t.id)

describe('TransactionService.list paging', () => {
  it.each([
    ['date', 'desc'],
    ['date', 'asc'],
    ['amount', 'desc'],
    ['amount', 'asc'],
    ['merchant', 'desc'],
    ['merchant', 'asc'],
  ] as const)('visits every row exactly once, in order, sorting by %s %s', async (sort, direction) => {
    const pages = await walk({ ...base, sort, direction })

    const everything = await service.list(ALICE, { ...base, sort, direction, limit: 200 })
    expect(everything.items).toHaveLength(23)
    expect(everything.nextCursor).toBeNull()
    expect(ids(pages)).toEqual(everything.items.map((t) => t.id))
    expect(new Set(ids(pages)).size).toBe(23)
    expect(pages.map((p) => p.length)).toEqual([5, 5, 5, 5, 3])
  })

  it('breaks ties on the id in the sort direction', async () => {
    const asc = (await walk({ ...base, direction: 'asc' })).flat()
    const desc = (await walk({ ...base, direction: 'desc' })).flat()

    const tied = (rows: Transaction[]) => rows.filter((t) => t.transaction_date === DATES[0])
    expect(tied(asc).map((t) => t.id)).toEqual(tied(asc).map((t) => t.id).sort())
    expect(tied(desc).map((t) => t.id)).toEqual(tied(desc).map((t) => t.id).sort().reverse())
  })

  it('sorts amounts numerically, not as text', async () => {
    uow.ledger.transactions.length = 0
    for (const amount of ['-9.00', '-10.00', '100.00', '-2.50']) {
      await service.create(ALICE, { accountId: 'acc-checking', amount, merchant: 'M', transactionDate: DATES[0]! })
    }

    const pages = await walk({ ...base, sort: 'amount', direction: 'asc', limit: 3 })

    expect(pages.flat().map((t) => t.amount)).toEqual(['-10.00', '-9.00', '-2.50', '100.00'])
  })

  it('gives a null cursor when the last page is exactly full', async () => {
    const result = await service.list(ALICE, { ...base, limit: 23 })

    expect(result.items).toHaveLength(23)
    expect(result.nextCursor).toBeNull()
  })

  it('gives a cursor when exactly one row remains, and that page is the last', async () => {
    const first = await service.list(ALICE, { ...base, limit: 22 })
    expect(first.nextCursor).not.toBeNull()

    const last = await service.list(ALICE, { ...base, limit: 22, cursor: first.nextCursor! })

    expect(last.items).toHaveLength(1)
    expect(last.nextCursor).toBeNull()
  })

  it('returns an empty last page for no matches', async () => {
    const result = await service.list(ALICE, { ...base, search: 'no such merchant' })

    expect(result).toEqual({ items: [], nextCursor: null })
  })

  it('never lists another user\'s rows', async () => {
    const seen = ids(await walk({ ...base, limit: 200 }))

    expect(uow.ledger.transactions.filter((t) => seen.includes(t.id)).every((t) => t.user_id === ALICE)).toBe(true)
  })

  it('carries the sort, direction and last row in the cursor', async () => {
    const page = await service.list(ALICE, { ...base, sort: 'amount', direction: 'asc' })
    const last = page.items.at(-1)!

    expect(page.nextCursor).toEqual({ sort: 'amount', direction: 'asc', value: last.amount, id: last.id })
  })

  it('does not repeat or skip rows when a row is inserted between pages', async () => {
    const first = await service.list(ALICE, base)
    // Sorts before everything already listed and after everything not yet seen.
    await service.create(ALICE, { accountId: 'acc-checking', amount: '-1.00', merchant: 'Late', transactionDate: '2027-01-01' })
    await service.create(ALICE, { accountId: 'acc-checking', amount: '-1.00', merchant: 'Early', transactionDate: '2000-01-01' })

    const rest = await walk({ ...base, cursor: first.nextCursor! })

    const seen = [...first.items, ...rest.flat()].map((t) => t.id)
    expect(new Set(seen).size).toBe(seen.length)
    expect(rest.flat().some((t) => t.merchant === 'Early')).toBe(true)
    expect(rest.flat().some((t) => t.merchant === 'Late')).toBe(false)
  })
})

describe('TransactionService.list filters', () => {
  it('composes every filter with the cursor', async () => {
    const filter: Partial<TransactionListQuery> = {
      accountId: 'acc-checking', from: '2026-03-01', to: '2026-03-02', search: 'SHOP', uncategorizedOnly: true,
    }
    const expected = uow.ledger.transactions.filter(
      (t) =>
        t.user_id === ALICE && t.account_id === 'acc-checking' && t.category_id === null &&
        t.transaction_date >= '2026-03-01' && t.transaction_date <= '2026-03-02',
    )
    expect(expected.length).toBeGreaterThan(3)

    const pages = await walk({ ...base, ...filter, limit: 3 })

    expect(new Set(ids(pages))).toEqual(new Set(expected.map((t) => t.id)))
    expect(ids(pages)).toHaveLength(expected.length)
  })

  it('matches a parent category together with its children', async () => {
    const withParent = await walk({ ...base, categoryId: 'cat-food', limit: 2 })

    const rows = withParent.flat()
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((t) => t.category_id === 'cat-groceries')).toBe(true)
    expect(ids(await walk({ ...base, categoryId: 'cat-groceries', limit: 2 }))).toEqual(ids(withParent))
  })

  it('takes the filters from the query, not from the cursor', async () => {
    const first = await service.list(ALICE, { ...base, accountId: 'acc-checking', limit: 2 })

    const next = await service.list(ALICE, { ...base, accountId: 'acc-savings', limit: 50, cursor: first.nextCursor! })

    expect(next.items.every((t) => t.account_id === 'acc-savings')).toBe(true)
  })
})

describe('TransactionService.list total', () => {
  it('is left out unless asked for', async () => {
    const result = await service.list(ALICE, base)

    expect(result).not.toHaveProperty('total')
  })

  it('counts every match, ignoring the page size and the cursor', async () => {
    const first = await service.list(ALICE, { ...base, accountId: 'acc-checking', withTotal: true })
    const later = await service.list(ALICE, {
      ...base, accountId: 'acc-checking', withTotal: true, cursor: first.nextCursor!,
    })

    const expected = uow.ledger.transactions.filter((t) => t.user_id === ALICE && t.account_id === 'acc-checking')
    expect(first.total).toBe(expected.length)
    expect(later.total).toBe(expected.length)
  })
})

describe('TransactionService.list cursor validation', () => {
  const cursor: TransactionCursor = { sort: 'date', direction: 'desc', value: '2026-03-02', id: 'id' }

  it.each([
    ['sort', { sort: 'amount', direction: 'desc' }],
    ['direction', { sort: 'date', direction: 'asc' }],
  ] as const)('rejects a cursor issued for a different %s', async (_what, order) => {
    await expect(service.list(ALICE, { ...base, ...order, cursor })).rejects.toBeInstanceOf(ValidationError)
  })
})
