import { selectForSituations, type Situation } from '../catalog.js'
import type { CategoryRepository } from '../repository/CategoryRepository.js'
import type { StarterResult } from './StarterResult.js'

/**
 * Creates the catalog entries matching a set of situations.
 *
 * Additive and idempotent. A slug the user already has is left exactly as it
 * is (not updated, not renamed), because their version may have been edited and
 * a starter set has no business overwriting a real category. Running it twice,
 * or again after answering another wizard question, adds only what is missing.
 *
 * Parents are inserted before children so each child's `parent_id` resolves;
 * the selection order guarantees that.
 *
 * @param categories - Category repository bound to the current user's transaction.
 * @param userId - Owner of the new categories.
 * @param situations - Situations the user selected.
 * @returns Counts of created and skipped categories.
 */
export async function createStarterCategories(
  categories: CategoryRepository,
  userId: string,
  situations: readonly Situation[],
): Promise<StarterResult> {
  const chosen = selectForSituations(situations)
  const existing = await categories.listSummaries()
  const idBySlug = new Map(existing.map((c) => [c.slug.toLowerCase(), c.id]))

  let created = 0
  let skipped = 0

  for (const entry of chosen) {
    if (idBySlug.has(entry.slug)) {
      skipped += 1
      continue
    }
    const parentId = entry.parent === null ? null : (idBySlug.get(entry.parent) ?? null)
    // A child whose parent is missing would be a silent orphan. The selection
    // guarantees the parent came first, so this is a guard against a bug.
    if (entry.parent !== null && parentId === null) continue

    const row = await categories.insert({
      userId,
      name: entry.name,
      slug: entry.slug,
      parentId,
      icon: entry.icon,
      sortOrder: entry.sortOrder,
      // Without an explicit kind every starter category would land as an
      // expense, counting the Income branch as spending and leaving the
      // Transfers branch excluding nothing.
      kind: entry.kind ?? 'expense',
    })
    idBySlug.set(row.slug.toLowerCase(), row.id)
    created += 1
  }

  return { created, skipped, situations }
}
