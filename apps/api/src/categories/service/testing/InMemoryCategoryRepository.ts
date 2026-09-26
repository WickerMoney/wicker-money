import { randomUUID } from 'node:crypto'
import { DuplicateKeyError } from '../../../data/DuplicateKeyError.js'
import type { Category, CategoryKind } from '../../../db/models/index.js'
import type { CategoryChanges } from '../../repository/CategoryChanges.js'
import type { CategoryNode } from '../../repository/CategoryNode.js'
import type { CategoryRepository } from '../../repository/CategoryRepository.js'
import type { CategorySummary } from '../../repository/CategorySummary.js'
import type { NewCategoryInput } from '../../repository/NewCategoryInput.js'
import type { FakeCategoryState } from './FakeCategoryState.js'

/**
 * A {@link CategoryRepository} over in-memory state.
 *
 * Rows of other users are invisible, as row-level security makes them in the
 * database, and a second category with the same slug for one user raises
 * {@link DuplicateKeyError}.
 */
export class InMemoryCategoryRepository implements CategoryRepository {
  /**
   * @param state - Shared state.
   * @param userId - The user whose rows are visible.
   */
  constructor(
    private readonly state: FakeCategoryState,
    private readonly userId: string,
  ) {}

  private visible(): Category[] {
    return this.state.categories.filter((c) => c.user_id === this.userId)
  }

  /** @inheritdoc */
  list(): Promise<Category[]> {
    return Promise.resolve(
      this.visible().sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
    )
  }

  /** @inheritdoc */
  findNode(id: string): Promise<CategoryNode | undefined> {
    const c = this.visible().find((row) => row.id === id)
    return Promise.resolve(c === undefined ? undefined : { id: c.id, parent_id: c.parent_id, name: c.name })
  }

  /** @inheritdoc */
  listSummaries(): Promise<CategorySummary[]> {
    return Promise.resolve(
      this.visible().map((c) => ({ id: c.id, slug: c.slug, name: c.name, parent_id: c.parent_id })),
    )
  }

  /** @inheritdoc */
  hasChildren(id: string): Promise<boolean> {
    return Promise.resolve(this.visible().some((c) => c.parent_id === id))
  }

  /** @inheritdoc */
  countChildren(id: string): Promise<number> {
    return Promise.resolve(this.visible().filter((c) => c.parent_id === id).length)
  }

  /** @inheritdoc */
  insert(input: NewCategoryInput): Promise<Category> {
    if (this.visible().some((c) => c.slug === input.slug)) {
      return Promise.reject(new DuplicateKeyError('uq_categories_user_slug', undefined))
    }
    const now = new Date()
    const row: Category = {
      id: randomUUID(),
      user_id: input.userId,
      name: input.name,
      slug: input.slug,
      parent_id: input.parentId,
      icon: input.icon,
      is_system: false,
      is_enabled: true,
      kind: input.kind,
      sort_order: input.sortOrder,
      created_at: now,
      updated_at: now,
    }
    this.state.categories.push(row)
    return Promise.resolve({ ...row })
  }

  /** @inheritdoc */
  update(id: string, changes: CategoryChanges): Promise<Category> {
    const row = this.visible().find((c) => c.id === id)
    if (row === undefined) return Promise.reject(new Error(`No category ${id} to update.`))
    if (changes.name !== undefined) row.name = changes.name
    if (changes.parentId !== undefined) row.parent_id = changes.parentId
    if (changes.icon !== undefined) row.icon = changes.icon
    if (changes.isEnabled !== undefined) row.is_enabled = changes.isEnabled
    if (changes.kind !== undefined) row.kind = changes.kind
    if (changes.sortOrder !== undefined) row.sort_order = changes.sortOrder
    row.updated_at = new Date()
    return Promise.resolve({ ...row })
  }

  /** @inheritdoc */
  disableChildren(parentId: string): Promise<void> {
    for (const c of this.visible()) if (c.parent_id === parentId) c.is_enabled = false
    return Promise.resolve()
  }

  /** @inheritdoc */
  setChildrenKind(parentId: string, kind: CategoryKind): Promise<void> {
    for (const c of this.visible()) if (c.parent_id === parentId) c.kind = kind
    return Promise.resolve()
  }

  /** @inheritdoc */
  delete(id: string): Promise<boolean> {
    const before = this.state.categories.length
    this.state.categories = this.state.categories.filter((c) => !(c.user_id === this.userId && c.id === id))
    return Promise.resolve(this.state.categories.length < before)
  }

  /** @inheritdoc */
  findIdsInUse(ids: readonly string[]): Promise<Set<string>> {
    const used = new Set<string>()
    for (const t of this.state.transactions) {
      if (t.userId === this.userId && t.categoryId !== null && ids.includes(t.categoryId)) used.add(t.categoryId)
    }
    for (const r of this.state.rules) {
      if (r.user_id === this.userId && ids.includes(r.category_id)) used.add(r.category_id)
    }
    return Promise.resolve(used)
  }
}
