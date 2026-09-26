import type { Category } from '../../db/models/index.js'
import type { Repositories } from '../../data/Repositories.js'
import type { UnitOfWork } from '../../data/UnitOfWork.js'
import { DuplicateKeyError } from '../../data/DuplicateKeyError.js'
import { ConflictError, NotFoundError, ValidationError } from '../../errors.js'
import { CATEGORY_CATALOG, SITUATION_GROUPS, type Situation } from '../catalog.js'
import type { CategoryChanges } from '../repository/CategoryChanges.js'
import { assertValidReparent } from './assertValidReparent.js'
import type { CategoryUsage } from './CategoryUsage.js'
import { createStarterCategories } from './createStarterCategories.js'
import { describeUsage } from './describeUsage.js'
import type { NewCategory } from './NewCategory.js'
import type { StarterResult } from './StarterResult.js'
import { TWO_LEVELS } from './TWO_LEVELS.js'

/** Business rules for the category tree. */
export class CategoryService {
  /** @param uow - Opens transactions and supplies repositories. */
  constructor(private readonly uow: UnitOfWork) {}

  /**
   * @param userId - The signed-in user.
   * @returns The user's categories in display order.
   */
  list(userId: string): Promise<Category[]> {
    return this.uow.forUser(userId, (r) => r.categories.list())
  }

  /** @returns The full catalog and its situation groups. Inert data; no database access. */
  catalog(): { entries: typeof CATEGORY_CATALOG; groups: typeof SITUATION_GROUPS } {
    return { entries: CATEGORY_CATALOG, groups: SITUATION_GROUPS }
  }

  /**
   * Creates a category.
   *
   * @param userId - The signed-in user.
   * @param input - The new category.
   * @returns The created row.
   * @throws {NotFoundError} If the parent does not exist.
   * @throws {ValidationError} If the parent is itself a child (two levels only).
   * @throws {ConflictError} If the user already has a category with that slug.
   */
  async create(userId: string, input: NewCategory): Promise<Category> {
    try {
      return await this.uow.forUser(userId, async ({ categories }) => {
        if (input.parentId !== undefined && input.parentId !== null) {
          const parent = await categories.findNode(input.parentId)
          if (parent === undefined) throw new NotFoundError('Parent category')
          if (parent.parent_id !== null) throw new ValidationError(TWO_LEVELS)
        }
        return categories.insert({
          userId,
          name: input.name,
          slug: input.slug,
          parentId: input.parentId ?? null,
          icon: input.icon ?? null,
          sortOrder: input.sortOrder,
          kind: input.kind,
        })
      })
    } catch (error) {
      if (error instanceof DuplicateKeyError) {
        throw new ConflictError(`You already have a category called '${input.name}'.`, 'category_exists')
      }
      throw error
    }
  }

  /**
   * Creates the catalog entries matching a set of situations. Additive and idempotent.
   *
   * @param userId - The signed-in user.
   * @param situations - Situations the user selected.
   * @returns Counts of created and skipped categories.
   */
  addStarter(userId: string, situations: readonly Situation[]): Promise<StarterResult> {
    return this.uow.forUser(userId, (r) => createStarterCategories(r.categories, userId, situations))
  }

  /**
   * Renames, re-parents, re-icons, re-orders or enables/disables one category.
   *
   * The slug is deliberately not editable: it is the catalog's join key, and
   * renaming it would make the next starter run create duplicates.
   * Disabling a parent disables its children, and changing a parent's kind
   * cascades to its children, so a parent never disagrees with them.
   *
   * @param userId - The signed-in user.
   * @param id - Category to change.
   * @param changes - Fields to change.
   * @returns The updated row.
   * @throws {NotFoundError} If the category or the new parent does not exist.
   * @throws {ValidationError} If the change would break the two-level rule or make a category its own parent.
   */
  update(userId: string, id: string, changes: CategoryChanges): Promise<Category> {
    return this.uow.forUser(userId, async ({ categories }) => {
      if ((await categories.findNode(id)) === undefined) throw new NotFoundError('Category')

      if (changes.parentId !== undefined && changes.parentId !== null) {
        await assertValidReparent(categories, id, changes.parentId)
      }

      const updated = await categories.update(id, changes)
      // A hidden parent with visible children would leave orphans in the pickers.
      if (changes.isEnabled === false) await categories.disableChildren(id)
      // Children must share the parent's kind; otherwise marking a parent as a
      // transfer would exclude nothing while its children still counted as expenses.
      if (changes.kind !== undefined) await categories.setChildrenKind(id, changes.kind)
      return updated
    })
  }

  /**
   * Reports what still references a category, so a client can explain why it cannot be deleted.
   *
   * @param userId - The signed-in user.
   * @param id - The category.
   * @returns Reference counts, including child categories.
   */
  usage(userId: string, id: string): Promise<CategoryUsage> {
    return this.uow.forUser(userId, (r) => this.usageWithin(r, id))
  }

  /**
   * Deletes a category that nothing references.
   *
   * Usage is checked up front rather than left to the foreign-key constraint, so
   * the conflict explains what is using the category and suggests disabling it.
   *
   * @param userId - The signed-in user.
   * @param id - The category.
   * @throws {NotFoundError} If it does not exist.
   * @throws {ConflictError} If anything still references it.
   */
  async delete(userId: string, id: string): Promise<void> {
    await this.uow.forUser(userId, async (repos) => {
      const existing = await repos.categories.findNode(id)
      if (existing === undefined) throw new NotFoundError('Category')

      const usage = await this.usageWithin(repos, id)
      if (usage.total > 0) {
        throw new ConflictError(
          `'${existing.name}' is still used by ${describeUsage(usage)}. ` +
            `Disable it instead to keep the history and hide it from the pickers.`,
          'category_in_use',
        )
      }
      await repos.categories.delete(id)
    })
  }

  /**
   * Combines foreign-key usage (discovered from the catalog, so plugin tables
   * are included) with the direct child count.
   */
  private async usageWithin(repos: Repositories, id: string): Promise<CategoryUsage> {
    const usage = await repos.usage.summarize('core.categories', '%category_id', id)
    const childCount = await repos.categories.countChildren(id)
    return { total: usage.total + childCount, by: usage.by, unreadable: usage.unreadable, childCount }
  }
}
