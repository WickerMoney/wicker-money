import type { TransactionChanges } from '../repository/TransactionChanges.js'

/**
 * Builds the category columns for an edit.
 *
 * @param categoryId - The requested category, `null` to clear it, or undefined to leave it alone.
 * @returns The category and its source, or nothing when the category is not being edited.
 */
export function buildCategoryChanges(categoryId: string | null | undefined): TransactionChanges {
  if (categoryId === undefined) return {}
  // A person editing a category is the definition of a manual assignment.
  return { categoryId, categorySource: categoryId === null ? null : 'manual' }
}
