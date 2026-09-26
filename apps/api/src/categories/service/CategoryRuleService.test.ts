import { beforeEach, describe, expect, it } from 'vitest'
import { NotFoundError } from '../../errors.js'
import { CategoryRuleService } from './CategoryRuleService.js'
import type { ConditionInput } from './ConditionInput.js'
import type { NewRule } from './NewRule.js'
import { RULE_PAGE_SIZE } from './RULE_PAGE_SIZE.js'
import type { FakeTransaction } from './testing/FakeTransaction.js'
import { InMemoryCategoryUnitOfWork } from './testing/InMemoryCategoryUnitOfWork.js'

const ALICE = '00000000-0000-4000-8000-00000000000a'
const BOB = '00000000-0000-4000-8000-00000000000b'
const COFFEE = '00000000-0000-4000-8000-0000000000c1'
const OTHER_CATEGORY = '00000000-0000-4000-8000-0000000000c2'

let uow: InMemoryCategoryUnitOfWork
let service: CategoryRuleService
let seq = 0

/** Sequential, sortable ids so keyset paging order is deterministic. */
const nextId = (): string => `00000000-0000-4000-9000-${(seq += 1).toString(16).padStart(12, '0')}`

function tx(over: Partial<FakeTransaction> = {}): FakeTransaction {
  const row: FakeTransaction = {
    id: nextId(), userId: ALICE, merchant: 'Blue Bottle Coffee', notes: null, amount: '-4.5000',
    categoryId: null, categorySource: null, transferId: null, ...over,
  }
  uow.state.transactions.push(row)
  return row
}

const coffee: ConditionInput = {
  conditionType: 'merchant_contains', textValue: 'coffee', isCaseSensitive: false,
}

const rule = (over: Partial<NewRule> = {}): NewRule => ({
  categoryId: COFFEE, priority: 0, conditions: [coffee], applyToExisting: false, ...over,
})

const find = (id: string): FakeTransaction =>
  uow.state.transactions.find((t) => t.id === id) as FakeTransaction

/** Registers the target categories every rule in these tests points at, for both users. */
function seedCategories(): void {
  const now = new Date()
  for (const [userId, id] of [[ALICE, COFFEE], [ALICE, OTHER_CATEGORY], [BOB, COFFEE]] as const) {
    uow.state.categories.push({
      id, user_id: userId, name: id, slug: id, parent_id: null, icon: null, is_system: false,
      is_enabled: true, kind: 'expense', sort_order: 0, created_at: now, updated_at: now,
    })
  }
}

beforeEach(() => {
  seq = 0
  uow = new InMemoryCategoryUnitOfWork()
  seedCategories()
  service = new CategoryRuleService(uow)
})

describe('CategoryRuleService.create', () => {
  it('stores the rule with its conditions and applies it to matching uncategorized transactions', async () => {
    const hit = tx()
    const miss = tx({ merchant: 'Landlord' })

    const { rule: created, recategorized } = await service.create(ALICE, rule({ priority: 5 }))

    expect(recategorized).toBe(1)
    expect(created).toMatchObject({ user_id: ALICE, category_id: COFFEE, priority: 5 })
    expect(created.conditions).toHaveLength(1)
    expect(created.conditions[0]).toMatchObject({
      rule_id: created.id, condition_type: 'merchant_contains', text_value: 'coffee', is_case_sensitive: false,
    })
    expect(find(hit.id)).toMatchObject({ categoryId: COFFEE, categorySource: 'rule' })
    expect(find(miss.id)).toMatchObject({ categoryId: null, categorySource: null })
  })

  it('requires every condition to match (AND)', async () => {
    const both = tx({ merchant: 'Blue Bottle Coffee', amount: '-4.5000' })
    const wrongAmount = tx({ merchant: 'Blue Bottle Coffee', amount: '-40.0000' })

    const { recategorized } = await service.create(
      ALICE,
      rule({
        conditions: [
          coffee,
          { conditionType: 'amount_range', direction: 'out', amountMin: '1', amountMax: '10' },
        ],
      }),
    )

    expect(recategorized).toBe(1)
    expect(find(both.id).categoryId).toBe(COFFEE)
    expect(find(wrongAmount.id).categoryId).toBeNull()
  })

  it('leaves already-categorized rows alone unless applyToExisting is set', async () => {
    const byImport = tx({ categoryId: OTHER_CATEGORY, categorySource: 'import' })

    expect((await service.create(ALICE, rule())).recategorized).toBe(0)
    expect(find(byImport.id).categoryId).toBe(OTHER_CATEGORY)

    expect((await service.create(ALICE, rule({ applyToExisting: true }))).recategorized).toBe(1)
    expect(find(byImport.id)).toMatchObject({ categoryId: COFFEE, categorySource: 'rule' })
  })

  it('never touches a manually categorized row, even with applyToExisting', async () => {
    const manual = tx({ categoryId: OTHER_CATEGORY, categorySource: 'manual' })

    const { recategorized } = await service.create(ALICE, rule({ applyToExisting: true }))

    expect(recategorized).toBe(0)
    expect(find(manual.id)).toMatchObject({ categoryId: OTHER_CATEGORY, categorySource: 'manual' })
  })

  it('never touches transfer legs', async () => {
    const leg = tx({ merchant: 'Transfer to Coffee Fund', transferId: 'transfer-1' })

    const { recategorized } = await service.create(ALICE, rule({ applyToExisting: true }))

    expect(recategorized).toBe(0)
    expect(find(leg.id)).toMatchObject({ categoryId: null, categorySource: null })
  })

  it("never touches another user's transactions", async () => {
    const theirs = tx({ userId: BOB })

    expect((await service.create(ALICE, rule({ applyToExisting: true }))).recategorized).toBe(0)
    expect(find(theirs.id).categoryId).toBeNull()
  })

  it('404s when the target category is missing or belongs to someone else, storing nothing', async () => {
    tx()
    uow.state.categories = uow.state.categories.filter((c) => c.user_id !== ALICE || c.id !== COFFEE)

    const error = await service.create(ALICE, rule()).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(NotFoundError)
    expect((error as Error).message).toBe('Category not found.')
    expect(uow.state.rules).toEqual([])
    expect(uow.state.transactions[0]?.categoryId).toBeNull()
  })

  it('applies a rule created with no matches and still stores it', async () => {
    tx({ merchant: 'Landlord' })

    const { recategorized, rule: created } = await service.create(ALICE, rule())

    expect(recategorized).toBe(0)
    expect(uow.state.rules.map((r) => r.id)).toEqual([created.id])
  })

  it('stores nothing when applying fails part-way', async () => {
    tx()
    const failing = new InMemoryCategoryUnitOfWork()
    failing.state = uow.state
    const original = failing.forUser.bind(failing)
    failing.forUser = (userId, work) =>
      original(userId, (repos) =>
        work({
          ...repos,
          transactions: {
            assignCategory: () => Promise.reject(new Error('boom')),
          } as unknown as typeof repos.transactions,
        }),
      )

    await expect(new CategoryRuleService(failing).create(ALICE, rule())).rejects.toThrow('boom')

    expect(failing.state.rules).toEqual([])
    expect(failing.state.conditions).toEqual([])
  })
})

describe('CategoryRuleService paging', () => {
  it('reads candidates in pages of RULE_PAGE_SIZE and categorizes every match across pages', async () => {
    const total = RULE_PAGE_SIZE * 2 + 345
    for (let i = 0; i < total; i += 1) tx()

    const { recategorized } = await service.create(ALICE, rule())

    expect(recategorized).toBe(total)
    expect(uow.state.transactions.every((t) => t.categoryId === COFFEE && t.categorySource === 'rule')).toBe(true)
    expect(uow.state.pageLimits).toEqual([RULE_PAGE_SIZE, RULE_PAGE_SIZE, RULE_PAGE_SIZE])
  })

  it('stops after an exactly-full final page by asking once more and getting nothing', async () => {
    for (let i = 0; i < RULE_PAGE_SIZE * 2; i += 1) tx()

    expect((await service.create(ALICE, rule())).recategorized).toBe(RULE_PAGE_SIZE * 2)
    expect(uow.state.pageLimits).toHaveLength(3)
  })

  it('makes a single request when everything fits on one page', async () => {
    for (let i = 0; i < 10; i += 1) tx()

    await service.create(ALICE, rule())

    expect(uow.state.pageLimits).toHaveLength(1)
  })

  it('does not skip or repeat rows when only some of each page match', async () => {
    const total = RULE_PAGE_SIZE + 200
    const expectedHits = new Set<string>()
    for (let i = 0; i < total; i += 1) {
      const isHit = i % 3 === 0
      const row = tx({ merchant: isHit ? 'Coffee' : 'Landlord' })
      if (isHit) expectedHits.add(row.id)
    }

    const { recategorized } = await service.create(ALICE, rule())

    expect(recategorized).toBe(expectedHits.size)
    const assigned = new Set(uow.state.transactions.filter((t) => t.categoryId === COFFEE).map((t) => t.id))
    expect(assigned).toEqual(expectedHits)
  })

  it('pages the preview the same way and reports totals across pages', async () => {
    const total = RULE_PAGE_SIZE + 10
    for (let i = 0; i < total; i += 1) tx()
    for (let i = 0; i < 7; i += 1) tx({ categoryId: OTHER_CATEGORY, categorySource: 'rule' })

    const result = await service.preview(ALICE, rule({ applyToExisting: true }))

    expect(result).toEqual({ wouldCategorize: total, wouldRecategorize: 7 })
    expect(uow.state.pageLimits.length).toBeGreaterThan(1)
  })
})

describe('CategoryRuleService.preview', () => {
  it('counts uncategorized and re-categorizable rows without changing anything', async () => {
    tx()
    tx()
    tx({ categoryId: OTHER_CATEGORY, categorySource: 'import' })
    tx({ categoryId: OTHER_CATEGORY, categorySource: 'manual' })
    tx({ merchant: 'Landlord' })
    const before = structuredClone(uow.state.transactions)

    const result = await service.preview(ALICE, rule({ applyToExisting: true }))

    expect(result).toEqual({ wouldCategorize: 2, wouldRecategorize: 1 })
    expect(uow.state.transactions).toEqual(before)
    expect(uow.state.rules).toEqual([])
  })

  it('ignores categorized rows unless applyToExisting is set', async () => {
    tx({ categoryId: OTHER_CATEGORY, categorySource: 'import' })
    tx()

    expect(await service.preview(ALICE, rule())).toEqual({ wouldCategorize: 1, wouldRecategorize: 0 })
  })

  it('agrees with what create then does', async () => {
    tx(); tx({ categoryId: OTHER_CATEGORY, categorySource: 'ai' }); tx({ categoryId: OTHER_CATEGORY, categorySource: 'manual' })
    const body = rule({ applyToExisting: true })

    const preview = await service.preview(ALICE, body)
    const created = await service.create(ALICE, body)

    expect(created.recategorized).toBe(preview.wouldCategorize + preview.wouldRecategorize)
  })

  it('reports zero for a rule that matches nothing', async () => {
    tx({ merchant: 'Landlord' })
    expect(await service.preview(ALICE, rule())).toEqual({ wouldCategorize: 0, wouldRecategorize: 0 })
  })
})

describe('CategoryRuleService.list and delete', () => {
  it('lists only the caller\'s rules with their conditions', async () => {
    const mine = await service.create(ALICE, rule())
    await service.create(BOB, rule())

    const listed = await service.list(ALICE)

    expect(listed.map((r) => r.id)).toEqual([mine.rule.id])
    expect(listed[0]?.conditions).toHaveLength(1)
  })

  it('deletes a rule, and its conditions with it', async () => {
    const { rule: created } = await service.create(ALICE, rule())

    await service.delete(ALICE, created.id)

    expect(await service.list(ALICE)).toEqual([])
    expect(uow.state.conditions).toEqual([])
  })

  it('leaves transactions the rule already categorized as they were', async () => {
    const hit = tx()
    const { rule: created } = await service.create(ALICE, rule())

    await service.delete(ALICE, created.id)

    expect(find(hit.id)).toMatchObject({ categoryId: COFFEE, categorySource: 'rule' })
  })

  it('404s for an unknown rule', async () => {
    const error = await service.delete(ALICE, '00000000-0000-4000-8000-0000000000ff').catch((e: unknown) => e)

    expect(error).toBeInstanceOf(NotFoundError)
    expect((error as Error).message).toBe('Category rule not found.')
  })

  it("404s for another user's rule and leaves it in place", async () => {
    const { rule: theirs } = await service.create(BOB, rule())

    await expect(service.delete(ALICE, theirs.id)).rejects.toBeInstanceOf(NotFoundError)
    expect(await service.list(BOB)).toHaveLength(1)
  })
})
