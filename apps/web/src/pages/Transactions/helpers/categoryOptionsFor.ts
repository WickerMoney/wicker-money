import type { Category } from '../../../models/index.js'

/**
 * Chooses the options for one transaction's category cell.
 *
 * Returns the enabled categories plus, when the transaction is already filed
 * under a disabled one, that category too. A `<select>` whose value matches no
 * option renders blank, so without the exception a row filed under a retired
 * category would look uncategorized and changing anything else on it would
 * quietly clear the category.
 *
 * @param categories - Every category, enabled or not.
 * @param enabledCategories - The enabled subset of `categories`.
 * @param currentId - The category the transaction is currently filed under, if any.
 * @returns The categories to offer in that row's `<select>`.
 */
export function categoryOptionsFor(
  categories: readonly Category[],
  enabledCategories: readonly Category[],
  currentId: string | null,
): readonly Category[] {
  if (currentId === null) return enabledCategories
  const current = categories.find((c) => c.id === currentId)
  if (current === undefined || current.is_enabled) return enabledCategories
  return [...enabledCategories, current]
}
