import { beforeEach, describe, expect, it } from 'vitest'
import { ConflictError, NotFoundError, ValidationError } from '../../errors.js'
import type { CategoryKind } from '../../db/models/index.js'
import { CategoryService } from './CategoryService.js'
import type { NewCategory } from './NewCategory.js'
import { InMemoryCategoryUnitOfWork } from './testing/InMemoryCategoryUnitOfWork.js'

const ALICE = '00000000-0000-4000-8000-00000000000a'
const BOB = '00000000-0000-4000-8000-00000000000b'
const MISSING = '00000000-0000-4000-8000-0000000000ff'

let uow: InMemoryCategoryUnitOfWork
let service: CategoryService

const input = (over: Partial<NewCategory> & Pick<NewCategory, 'slug'>): NewCategory => ({
  name: over.slug,
  sortOrder: 0,
  kind: 'expense',
  ...over,
})

/** Rejection value of a promise that must fail, so the error's class and message can be asserted. */
async function failure(p: Promise<unknown>): Promise<unknown> {
  try {
    await p
  } catch (error) {
    return error
  }
  throw new Error('Expected the promise to reject.')
}

beforeEach(() => {
  uow = new InMemoryCategoryUnitOfWork()
  service = new CategoryService(uow)
})

describe('CategoryService.create', () => {
  it('creates a top-level category with defaults for the optional fields', async () => {
    const row = await service.create(ALICE, input({ slug: 'food', name: 'Food' }))

    expect(row).toMatchObject({ user_id: ALICE, name: 'Food', slug: 'food', parent_id: null, icon: null, kind: 'expense' })
    expect(await service.list(ALICE)).toHaveLength(1)
  })

  it('creates a child beneath a top-level parent', async () => {
    const parent = await service.create(ALICE, input({ slug: 'food' }))
    const child = await service.create(ALICE, input({ slug: 'snacks', parentId: parent.id, icon: 'cookie' }))

    expect(child.parent_id).toBe(parent.id)
    expect(child.icon).toBe('cookie')
  })

  it('refuses a third level with a ValidationError', async () => {
    const top = await service.create(ALICE, input({ slug: 'travel' }))
    const mid = await service.create(ALICE, input({ slug: 'flights', parentId: top.id }))

    const error = await failure(service.create(ALICE, input({ slug: 'baggage', parentId: mid.id })))

    expect(error).toBeInstanceOf(ValidationError)
    expect((error as ValidationError).message).toBe(
      'Categories are two levels deep. Choose a top-level category as the parent.',
    )
  })

  it('404s on a parent that does not exist', async () => {
    const error = await failure(service.create(ALICE, input({ slug: 'orphan', parentId: MISSING })))

    expect(error).toBeInstanceOf(NotFoundError)
    expect((error as NotFoundError).message).toBe('Parent category not found.')
  })

  it("cannot use another user's category as a parent", async () => {
    const theirs = await service.create(BOB, input({ slug: 'private' }))

    expect(await failure(service.create(ALICE, input({ slug: 'mine', parentId: theirs.id })))).toBeInstanceOf(
      NotFoundError,
    )
  })

  it('turns a duplicate slug into a ConflictError naming the category', async () => {
    await service.create(ALICE, input({ slug: 'food' }))

    const error = await failure(service.create(ALICE, input({ slug: 'food', name: 'Groceries' })))

    expect(error).toBeInstanceOf(ConflictError)
    expect(error).toMatchObject({
      statusCode: 409,
      code: 'category_exists',
      message: "You already have a category called 'Groceries'.",
    })
    expect(await service.list(ALICE)).toHaveLength(1)
  })

  it('allows two users the same slug', async () => {
    await service.create(ALICE, input({ slug: 'food' }))
    await expect(service.create(BOB, input({ slug: 'food' }))).resolves.toMatchObject({ user_id: BOB })
  })

  it('lists only the caller\'s categories, in display order', async () => {
    await service.create(ALICE, input({ slug: 'b', name: 'Bravo', sortOrder: 2 }))
    await service.create(ALICE, input({ slug: 'a', name: 'Alpha', sortOrder: 2 }))
    await service.create(ALICE, input({ slug: 'z', name: 'Zulu', sortOrder: 1 }))
    await service.create(BOB, input({ slug: 'x', name: 'Xray' }))

    expect((await service.list(ALICE)).map((c) => c.name)).toEqual(['Zulu', 'Alpha', 'Bravo'])
  })
})

describe('CategoryService.update', () => {
  it('404s when the category does not exist or belongs to someone else', async () => {
    const theirs = await service.create(BOB, input({ slug: 'private' }))

    expect(await failure(service.update(ALICE, MISSING, { name: 'x' }))).toBeInstanceOf(NotFoundError)
    expect(await failure(service.update(ALICE, theirs.id, { name: 'x' }))).toBeInstanceOf(NotFoundError)
    expect((await service.list(BOB))[0]?.name).toBe('private')
  })

  it('renames without touching the slug', async () => {
    const c = await service.create(ALICE, input({ slug: 'groceries' }))

    const updated = await service.update(ALICE, c.id, { name: 'Food shopping' })

    expect(updated).toMatchObject({ name: 'Food shopping', slug: 'groceries' })
  })

  it('moves a childless category under a top-level parent and back to the top', async () => {
    const parent = await service.create(ALICE, input({ slug: 'food' }))
    const child = await service.create(ALICE, input({ slug: 'snacks' }))

    expect((await service.update(ALICE, child.id, { parentId: parent.id })).parent_id).toBe(parent.id)
    expect((await service.update(ALICE, child.id, { parentId: null })).parent_id).toBeNull()
  })

  it('refuses to make a category its own parent', async () => {
    const c = await service.create(ALICE, input({ slug: 'loop' }))

    const error = await failure(service.update(ALICE, c.id, { parentId: c.id }))

    expect(error).toBeInstanceOf(ValidationError)
    expect((error as Error).message).toBe('A category cannot be its own parent.')
  })

  it('404s on a new parent that does not exist', async () => {
    const c = await service.create(ALICE, input({ slug: 'a' }))

    const error = await failure(service.update(ALICE, c.id, { parentId: MISSING }))

    expect(error).toBeInstanceOf(NotFoundError)
    expect((error as Error).message).toBe('Parent category not found.')
  })

  it('refuses a parent that is itself a child (third level)', async () => {
    const top = await service.create(ALICE, input({ slug: 'top' }))
    const mid = await service.create(ALICE, input({ slug: 'mid', parentId: top.id }))
    const spare = await service.create(ALICE, input({ slug: 'spare' }))

    expect(await failure(service.update(ALICE, spare.id, { parentId: mid.id }))).toBeInstanceOf(ValidationError)
  })

  it('refuses to move a category that has children of its own', async () => {
    const top = await service.create(ALICE, input({ slug: 'utilities' }))
    await service.create(ALICE, input({ slug: 'water', parentId: top.id }))
    const elsewhere = await service.create(ALICE, input({ slug: 'home' }))

    const error = await failure(service.update(ALICE, top.id, { parentId: elsewhere.id }))

    expect(error).toBeInstanceOf(ValidationError)
    expect((error as Error).message).toBe(
      'This category has children of its own, so it cannot be moved under another.',
    )
  })

  it('still lets a parent with children be renamed or moved to the top level', async () => {
    const top = await service.create(ALICE, input({ slug: 'utilities' }))
    await service.create(ALICE, input({ slug: 'water', parentId: top.id }))

    await expect(service.update(ALICE, top.id, { name: 'Bills', parentId: null })).resolves.toMatchObject({
      name: 'Bills',
    })
  })

  it('leaves a failed update entirely undone', async () => {
    const top = await service.create(ALICE, input({ slug: 'top' }))
    const mid = await service.create(ALICE, input({ slug: 'mid', parentId: top.id }))
    const spare = await service.create(ALICE, input({ slug: 'spare' }))

    await failure(service.update(ALICE, spare.id, { name: 'Renamed', parentId: mid.id }))

    expect((await service.list(ALICE)).find((c) => c.id === spare.id)?.name).toBe('spare')
  })

  describe('cascading', () => {
    async function familyOf(kind: CategoryKind = 'expense') {
      const parent = await service.create(ALICE, input({ slug: 'parent', kind }))
      const a = await service.create(ALICE, input({ slug: 'a', parentId: parent.id, kind }))
      const b = await service.create(ALICE, input({ slug: 'b', parentId: parent.id, kind }))
      const other = await service.create(ALICE, input({ slug: 'other', kind }))
      const otherChild = await service.create(ALICE, input({ slug: 'other-child', parentId: other.id, kind }))
      return { parent, a, b, other, otherChild }
    }
    const byId = async (id: string) => (await service.list(ALICE)).find((c) => c.id === id)

    it('disabling a parent disables its children and nobody else', async () => {
      const { parent, a, b, other, otherChild } = await familyOf()

      await service.update(ALICE, parent.id, { isEnabled: false })

      expect((await byId(parent.id))?.is_enabled).toBe(false)
      expect((await byId(a.id))?.is_enabled).toBe(false)
      expect((await byId(b.id))?.is_enabled).toBe(false)
      expect((await byId(other.id))?.is_enabled).toBe(true)
      expect((await byId(otherChild.id))?.is_enabled).toBe(true)
    })

    it('re-enabling a parent does not silently re-enable children', async () => {
      const { parent, a } = await familyOf()
      await service.update(ALICE, parent.id, { isEnabled: false })

      await service.update(ALICE, parent.id, { isEnabled: true })

      expect((await byId(parent.id))?.is_enabled).toBe(true)
      expect((await byId(a.id))?.is_enabled).toBe(false)
    })

    it('does not touch children when the parent stays enabled', async () => {
      const { parent, a } = await familyOf()

      await service.update(ALICE, parent.id, { isEnabled: true, name: 'Renamed' })

      expect((await byId(a.id))?.is_enabled).toBe(true)
    })

    it("changing a parent's kind changes its children's kind", async () => {
      const { parent, a, b, otherChild } = await familyOf('expense')

      await service.update(ALICE, parent.id, { kind: 'transfer' })

      expect((await byId(parent.id))?.kind).toBe('transfer')
      expect((await byId(a.id))?.kind).toBe('transfer')
      expect((await byId(b.id))?.kind).toBe('transfer')
      expect((await byId(otherChild.id))?.kind).toBe('expense')
    })

    it("never cascades a child's own change upward or sideways", async () => {
      const { parent, a, b } = await familyOf('expense')

      await service.update(ALICE, a.id, { kind: 'income', isEnabled: false })

      expect((await byId(parent.id))).toMatchObject({ kind: 'expense', is_enabled: true })
      expect((await byId(b.id))).toMatchObject({ kind: 'expense', is_enabled: true })
    })

    it("does not cascade another user's rows", async () => {
      const { parent } = await familyOf()
      const theirParent = await service.create(BOB, input({ slug: 'parent' }))
      const theirChild = await service.create(BOB, input({ slug: 'kid', parentId: theirParent.id }))

      await service.update(ALICE, parent.id, { isEnabled: false, kind: 'income' })

      expect((await service.list(BOB)).find((c) => c.id === theirChild.id)).toMatchObject({
        is_enabled: true,
        kind: 'expense',
      })
    })
  })
})

describe('CategoryService.delete and usage', () => {
  const seedTransactions = (categoryId: string, count: number): void => {
    for (let i = 0; i < count; i += 1) {
      uow.state.transactions.push({
        id: `t-${categoryId}-${i}`,
        userId: ALICE,
        merchant: 'm',
        notes: null,
        amount: '-1.0000',
        categoryId,
        categorySource: 'manual',
        transferId: null,
      })
    }
  }

  it('deletes a category nothing references', async () => {
    const c = await service.create(ALICE, input({ slug: 'unused' }))

    await service.delete(ALICE, c.id)

    expect(await service.list(ALICE)).toEqual([])
  })

  it('404s for a missing category and for one belonging to someone else', async () => {
    const theirs = await service.create(BOB, input({ slug: 'private' }))

    expect(await failure(service.delete(ALICE, MISSING))).toBeInstanceOf(NotFoundError)
    expect(await failure(service.delete(ALICE, theirs.id))).toBeInstanceOf(NotFoundError)
    expect(await service.list(BOB)).toHaveLength(1)
  })

  it('refuses a category in use and says what holds it, pluralised and ordered', async () => {
    const c = await service.create(ALICE, input({ slug: 'food', name: 'Food' }))
    seedTransactions(c.id, 3)
    uow.state.rules.push({
      id: 'r1', user_id: ALICE, category_id: c.id, priority: 0, created_at: new Date(), updated_at: new Date(),
    })

    const error = await failure(service.delete(ALICE, c.id))

    expect(error).toBeInstanceOf(ConflictError)
    expect(error).toMatchObject({
      statusCode: 409,
      code: 'category_in_use',
      message:
        "'Food' is still used by 3 transactions and 1 rule. " +
        'Disable it instead to keep the history and hide it from the pickers.',
    })
    expect(await service.list(ALICE)).toHaveLength(1)
  })

  it('counts child categories in the message', async () => {
    const parent = await service.create(ALICE, input({ slug: 'food', name: 'Food' }))
    await service.create(ALICE, input({ slug: 'a', parentId: parent.id }))
    await service.create(ALICE, input({ slug: 'b', parentId: parent.id }))
    seedTransactions(parent.id, 1)

    const error = await failure(service.delete(ALICE, parent.id))

    expect((error as ConflictError).message).toContain('is still used by 1 transaction and 2 child categories.')
  })

  it('names a plugin table it has a friendly noun for, and an unknown one as-is', async () => {
    const c = await service.create(ALICE, input({ slug: 'food', name: 'Food' }))
    uow.state.externalReferences.push(
      { userId: ALICE, table: 'plugin_budgets.budget_lines', categoryId: c.id },
      { userId: ALICE, table: 'plugin_budgets.budget_lines', categoryId: c.id },
      { userId: ALICE, table: 'plugin_x.things', categoryId: c.id },
    )

    const error = await failure(service.delete(ALICE, c.id))

    expect((error as ConflictError).message).toContain('is still used by 2 budget lines and 1 plugin_x.things.')
  })

  it('reports usage including the child count in the total', async () => {
    const parent = await service.create(ALICE, input({ slug: 'food' }))
    await service.create(ALICE, input({ slug: 'a', parentId: parent.id }))
    seedTransactions(parent.id, 2)

    const usage = await service.usage(ALICE, parent.id)

    expect(usage).toMatchObject({ total: 3, childCount: 1, unreadable: [] })
    expect(usage.by).toEqual([{ table: 'core.transactions', count: 2 }])
  })

  it('reports zero usage for a fresh category', async () => {
    const c = await service.create(ALICE, input({ slug: 'fresh' }))
    expect(await service.usage(ALICE, c.id)).toEqual({ total: 0, by: [], unreadable: [], childCount: 0 })
  })

  it("does not count another user's references", async () => {
    const c = await service.create(ALICE, input({ slug: 'food' }))
    uow.state.transactions.push({
      id: 't', userId: BOB, merchant: 'm', notes: null, amount: '-1', categoryId: c.id,
      categorySource: 'manual', transferId: null,
    })

    expect((await service.usage(ALICE, c.id)).total).toBe(0)
  })
})

describe('CategoryService.addStarter and catalog', () => {
  it('creates the universal set, skips what exists on a second run, and never overwrites an edit', async () => {
    const first = await service.addStarter(ALICE, ['always'])
    expect(first.created).toBeGreaterThan(0)
    expect(first.skipped).toBe(0)

    const groceries = (await service.list(ALICE)).find((c) => c.slug === 'groceries')
    expect(groceries).toBeDefined()
    await service.update(ALICE, (groceries as { id: string }).id, { name: 'My food' })

    const second = await service.addStarter(ALICE, ['always'])
    expect(second).toMatchObject({ created: 0, skipped: first.created })
    expect((await service.list(ALICE)).find((c) => c.slug === 'groceries')?.name).toBe('My food')
  })

  it('creates children under their parents, with the catalog kind', async () => {
    await service.addStarter(ALICE, ['always'])
    const rows = await service.list(ALICE)
    const byId = new Map(rows.map((c) => [c.id, c]))

    const children = rows.filter((c) => c.parent_id !== null)
    expect(children.length).toBeGreaterThan(0)
    for (const child of children) {
      const parent = byId.get(child.parent_id as string)
      expect(parent?.parent_id).toBeNull()
      expect(child.kind).toBe(parent?.kind)
    }
    expect(rows.some((c) => c.kind === 'income')).toBe(true)
  })

  it('does not share starter rows between users', async () => {
    await service.addStarter(ALICE, ['always'])
    expect(await service.list(BOB)).toEqual([])
    expect((await service.addStarter(BOB, ['always'])).skipped).toBe(0)
  })

  it('exposes the catalog without a database', () => {
    const { entries, groups } = service.catalog()
    expect(entries.length).toBeGreaterThan(0)
    expect(groups.length).toBeGreaterThan(0)
  })
})
