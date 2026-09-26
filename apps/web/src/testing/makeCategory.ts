import type { Category } from '../models/index.js'

/**
 * Builds a category for a test.
 *
 * @param patch - Fields to override.
 * @returns An enabled top-level expense category.
 */
export function makeCategory(patch: Partial<Category> = {}): Category {
  return { id: 'cat-1', name: 'Food', slug: 'food', parent_id: null, is_enabled: true, kind: 'expense', ...patch }
}
