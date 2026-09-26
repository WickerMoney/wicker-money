import { CATEGORY_CATALOG } from '../catalog.js'
import type { CategoryRepository } from '../repository/CategoryRepository.js'
import { deleteChildrenFirst } from './deleteChildrenFirst.js'
import { findPinnedCategoryIds } from './findPinnedCategoryIds.js'
import type { RemovalResult } from './RemovalResult.js'

/**
 * Removes starter categories that nothing is using.
 *
 * Intended only for re-running setup during development: it gets back to a
 * clean first run without dropping the database, and is deliberately timid.
 * Only slugs the catalog itself defines are eligible, so a category the user
 * invented is never touched. Anything referenced by a transaction, a split or
 * a rule is kept and named in the result. Children are deleted before parents.
 *
 * @param categories - Category repository bound to the current user's transaction.
 * @returns How many categories were removed and the names of those kept.
 */
export async function removeUnusedStarterCategories(categories: CategoryRepository): Promise<RemovalResult> {
  const catalogSlugs = new Set(CATEGORY_CATALOG.map((e) => e.slug))
  const mine = await categories.listSummaries()

  const candidates = mine.filter((c) => catalogSlugs.has(c.slug.toLowerCase()))
  if (candidates.length === 0) return { removed: 0, kept: [] }

  const referenced = await categories.findIdsInUse(candidates.map((c) => c.id))
  const inUse = findPinnedCategoryIds(mine, referenced, catalogSlugs)

  const removed = await deleteChildrenFirst(
    categories,
    candidates.filter((c) => !inUse.has(c.id)),
  )

  return { removed, kept: candidates.filter((c) => inUse.has(c.id)).map((c) => c.name) }
}
