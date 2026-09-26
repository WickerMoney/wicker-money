import type { Category } from '../../../models/index.js'

/**
 * Looks up a category's display name.
 *
 * @param categories - The loaded categories, or `null` while loading.
 * @param id - The category id to find.
 * @returns The name, or an em dash when the category is unknown or not yet loaded.
 */
export function categoryName(categories: readonly Category[] | null, id: string): string {
  return categories?.find((c) => c.id === id)?.name ?? '—'
}
