import type { CategoryRepository } from '../repository/CategoryRepository.js'
import type { CategorySummary } from '../repository/CategorySummary.js'

/**
 * Deletes categories, children before parents so a parent's children never
 * block its own deletion.
 *
 * @param categories - Repository used to delete.
 * @param doomed - The categories to delete.
 * @returns How many rows were actually deleted.
 */
export async function deleteChildrenFirst(
  categories: Pick<CategoryRepository, 'delete'>,
  doomed: readonly CategorySummary[],
): Promise<number> {
  const children = doomed.filter((c) => c.parent_id !== null)
  const parents = doomed.filter((c) => c.parent_id === null)
  let removed = 0
  for (const c of [...children, ...parents]) {
    if (await categories.delete(c.id)) removed += 1
  }
  return removed
}
