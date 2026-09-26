import type { CategoryRow } from '../repository/CategoryRow.js'
import { UNKNOWN_CATEGORY } from './UNKNOWN_CATEGORY.js'

/**
 * Builds a lookup from category id to display name.
 *
 * @param categories - The user's categories.
 * @returns A function returning a category's name, or a placeholder when the id is unknown.
 */
export function categoryNames(categories: readonly CategoryRow[]): (categoryId: string) => string {
  const byId = new Map(categories.map((c) => [c.id, c.name]))
  return (categoryId) => byId.get(categoryId) ?? UNKNOWN_CATEGORY
}
