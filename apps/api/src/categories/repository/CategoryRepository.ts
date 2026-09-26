import type { Category, CategoryKind } from '../../db/models/index.js'
import type { CategoryChanges } from './CategoryChanges.js'
import type { CategoryNode } from './CategoryNode.js'
import type { CategorySummary } from './CategorySummary.js'
import type { NewCategoryInput } from './NewCategoryInput.js'

/** Persistence operations for the category tree. All reads are scoped to the current user by row-level security. */
export interface CategoryRepository {
  /** @returns Every category, ordered by `sort_order` then name. */
  list(): Promise<Category[]>

  /**
   * @param id - Category id.
   * @returns The category's tree position, or `undefined` if it does not exist.
   */
  findNode(id: string): Promise<CategoryNode | undefined>

  /** @returns Every category's id, slug, name and parent, in no particular order. */
  listSummaries(): Promise<CategorySummary[]>

  /**
   * @param id - Category id.
   * @returns Whether any category names `id` as its parent.
   */
  hasChildren(id: string): Promise<boolean>

  /**
   * @param id - Category id.
   * @returns The number of direct children.
   */
  countChildren(id: string): Promise<number>

  /**
   * Inserts a category.
   *
   * @param input - The new category.
   * @returns The inserted row.
   * @throws {DuplicateKeyError} When the user already has a category with that slug.
   */
  insert(input: NewCategoryInput): Promise<Category>

  /**
   * Applies a partial update and stamps `updated_at`.
   *
   * @param id - Category id.
   * @param changes - Fields to change.
   * @returns The updated row.
   */
  update(id: string, changes: CategoryChanges): Promise<Category>

  /**
   * Disables every direct child of a category.
   *
   * @param parentId - The parent's id.
   */
  disableChildren(parentId: string): Promise<void>

  /**
   * Sets the cash-flow kind on every direct child of a category.
   *
   * @param parentId - The parent's id.
   * @param kind - The kind to apply.
   */
  setChildrenKind(parentId: string, kind: CategoryKind): Promise<void>

  /**
   * Deletes a category.
   *
   * @param id - Category id.
   * @returns Whether a row was deleted.
   */
  delete(id: string): Promise<boolean>

  /**
   * Finds which of the given categories are referenced by transactions, splits or rules.
   *
   * @param ids - Candidate category ids.
   * @returns The subset in use.
   */
  findIdsInUse(ids: readonly string[]): Promise<Set<string>>
}
