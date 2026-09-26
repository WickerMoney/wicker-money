import type { CategorySummary } from '../repository/CategorySummary.js'

/**
 * Works out which starter categories must be kept.
 *
 * A category is kept when something references it, when one of its children is
 * kept (the child's `parent_id` references it), or when it is the parent of a
 * category the user made themselves.
 *
 * @param all - Every category the user has.
 * @param referenced - Ids already known to be referenced by transactions, splits or rules.
 * @param catalogSlugs - Lower-cased slugs the starter catalog defines.
 * @returns The ids to keep.
 */
export function findPinnedCategoryIds(
  all: readonly CategorySummary[],
  referenced: ReadonlySet<string>,
  catalogSlugs: ReadonlySet<string>,
): Set<string> {
  const pinned = new Set(referenced)
  for (const c of all) {
    if (c.parent_id === null) continue
    if (pinned.has(c.id) || !catalogSlugs.has(c.slug.toLowerCase())) pinned.add(c.parent_id)
  }
  return pinned
}
