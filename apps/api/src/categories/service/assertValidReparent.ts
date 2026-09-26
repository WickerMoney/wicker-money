import { NotFoundError, ValidationError } from '../../errors.js'
import type { CategoryRepository } from '../repository/CategoryRepository.js'
import { TWO_LEVELS } from './TWO_LEVELS.js'

/**
 * Checks that a category may be moved under a new parent.
 *
 * The tree is two levels deep, so the parent must be top-level, and a category
 * that has children of its own cannot itself become a child.
 *
 * @param categories - Repository used for the lookups.
 * @param id - The category being moved.
 * @param parentId - The requested parent.
 * @throws {NotFoundError} If the parent does not exist.
 * @throws {ValidationError} If the category would be its own parent, the parent is itself a child, or the category has children.
 */
export async function assertValidReparent(
  categories: Pick<CategoryRepository, 'findNode' | 'hasChildren'>,
  id: string,
  parentId: string,
): Promise<void> {
  if (parentId === id) throw new ValidationError('A category cannot be its own parent.')
  const parent = await categories.findNode(parentId)
  if (parent === undefined) throw new NotFoundError('Parent category')
  if (parent.parent_id !== null) throw new ValidationError(TWO_LEVELS)
  if (await categories.hasChildren(id)) {
    throw new ValidationError('This category has children of its own, so it cannot be moved under another.')
  }
}
