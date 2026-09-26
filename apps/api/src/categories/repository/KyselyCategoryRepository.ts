import type { Category, CategoryKind } from '../../db/models/index.js'
import type { Trx } from '../../db/Trx.js'
import { translateDuplicateKey } from '../../data/translateDuplicateKey.js'
import type { CategoryChanges } from './CategoryChanges.js'
import type { CategoryNode } from './CategoryNode.js'
import type { CategoryRepository } from './CategoryRepository.js'
import type { CategorySummary } from './CategorySummary.js'
import type { NewCategoryInput } from './NewCategoryInput.js'

/** Kysely implementation of {@link CategoryRepository}. */
export class KyselyCategoryRepository implements CategoryRepository {
  /** @param trx - The transaction all queries run on. */
  constructor(private readonly trx: Trx) {}

  /** @inheritdoc */
  list(): Promise<Category[]> {
    return this.trx.selectFrom('core.categories').selectAll().orderBy('sort_order').orderBy('name').execute()
  }

  /** @inheritdoc */
  findNode(id: string): Promise<CategoryNode | undefined> {
    return this.trx
      .selectFrom('core.categories')
      .select(['id', 'parent_id', 'name'])
      .where('id', '=', id)
      .executeTakeFirst()
  }

  /** @inheritdoc */
  listSummaries(): Promise<CategorySummary[]> {
    return this.trx.selectFrom('core.categories').select(['id', 'slug', 'name', 'parent_id']).execute()
  }

  /** @inheritdoc */
  async hasChildren(id: string): Promise<boolean> {
    const row = await this.trx.selectFrom('core.categories').select('id').where('parent_id', '=', id).executeTakeFirst()
    return row !== undefined
  }

  /** @inheritdoc */
  async countChildren(id: string): Promise<number> {
    const row = await this.trx
      .selectFrom('core.categories')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('parent_id', '=', id)
      .executeTakeFirstOrThrow()
    return Number(row.n)
  }

  /** @inheritdoc */
  insert(input: NewCategoryInput): Promise<Category> {
    return translateDuplicateKey(() =>
      this.trx
        .insertInto('core.categories')
        .values({
          user_id: input.userId,
          name: input.name,
          slug: input.slug,
          parent_id: input.parentId,
          icon: input.icon,
          sort_order: input.sortOrder,
          kind: input.kind,
        })
        .returningAll()
        .executeTakeFirstOrThrow(),
    )
  }

  /** @inheritdoc */
  update(id: string, changes: CategoryChanges): Promise<Category> {
    return this.trx
      .updateTable('core.categories')
      .set({
        ...(changes.name !== undefined ? { name: changes.name } : {}),
        ...(changes.parentId !== undefined ? { parent_id: changes.parentId } : {}),
        ...(changes.icon !== undefined ? { icon: changes.icon } : {}),
        ...(changes.isEnabled !== undefined ? { is_enabled: changes.isEnabled } : {}),
        ...(changes.kind !== undefined ? { kind: changes.kind } : {}),
        ...(changes.sortOrder !== undefined ? { sort_order: changes.sortOrder } : {}),
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow()
  }

  /** @inheritdoc */
  async disableChildren(parentId: string): Promise<void> {
    await this.trx
      .updateTable('core.categories')
      .set({ is_enabled: false, updated_at: new Date() })
      .where('parent_id', '=', parentId)
      .execute()
  }

  /** @inheritdoc */
  async setChildrenKind(parentId: string, kind: CategoryKind): Promise<void> {
    await this.trx
      .updateTable('core.categories')
      .set({ kind, updated_at: new Date() })
      .where('parent_id', '=', parentId)
      .execute()
  }

  /** @inheritdoc */
  async delete(id: string): Promise<boolean> {
    const gone = await this.trx.deleteFrom('core.categories').where('id', '=', id).returning('id').executeTakeFirst()
    return gone !== undefined
  }

  /** @inheritdoc */
  async findIdsInUse(ids: readonly string[]): Promise<Set<string>> {
    const inUse = new Set<string>()
    if (ids.length === 0) return inUse
    const list = [...ids]
    const [txn, splits, rules] = await Promise.all([
      this.trx.selectFrom('core.transactions').select('category_id').where('category_id', 'in', list).execute(),
      this.trx.selectFrom('core.transaction_splits').select('category_id').where('category_id', 'in', list).execute(),
      this.trx.selectFrom('core.category_rules').select('category_id').where('category_id', 'in', list).execute(),
    ])
    for (const r of [...txn, ...splits, ...rules]) {
      if (r.category_id !== null) inUse.add(r.category_id)
    }
    return inUse
  }
}
