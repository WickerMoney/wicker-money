import type { GroupableCategory } from './GroupableCategory.js'

/**
 * Orders categories for display as a list: each parent followed by its own
 * children, then any children whose parent is not in the input.
 *
 * The API returns one flat sequence and the nesting is a display concern, so it
 * is resolved once here rather than in each page. {@link CategoryOptions} uses
 * the same grouping, so a list and a dropdown never disagree about where a
 * category sits.
 *
 * @param categories - The categories to order, in any order.
 * @returns A new array. Relative order within each level is preserved.
 */
export function orderByParent<T extends GroupableCategory>(categories: readonly T[]): T[] {
  const parents = categories.filter((c) => c.parent_id === null)
  const byParent = new Map<string, T[]>()
  for (const c of categories) {
    if (c.parent_id === null) continue
    const list = byParent.get(c.parent_id) ?? []
    list.push(c)
    byParent.set(c.parent_id, list)
  }
  const parentIds = new Set(parents.map((p) => p.id))
  const orphans = categories.filter((c) => c.parent_id !== null && !parentIds.has(c.parent_id))
  return [...parents.flatMap((p) => [p, ...(byParent.get(p.id) ?? [])]), ...orphans]
}
