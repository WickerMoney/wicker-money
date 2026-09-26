import { useMemo } from 'react'
import type { GroupableCategory } from './GroupableCategory.js'

/** Props for {@link CategoryOptions}. */
export interface CategoryOptionsProps {
  /** Categories to list; parents are followed by their children. */
  readonly categories: readonly GroupableCategory[]
  /** Rendered first, for "no category" or "all categories". */
  readonly placeholder?: { readonly value: string; readonly label: string }
  /**
   * Ids to leave out, for a picker that should not offer something already
   * chosen elsewhere. Children of an excluded parent are still offered;
   * exclusion is per id.
   */
  readonly exclude?: ReadonlySet<string>
  /**
   * `true` when choosing a parent means "this and everything under it".
   *
   * Changes only the parent's own option text, from `Food` to `All of Food`. A
   * filter behaves that way whether or not this is set; the label exists so the
   * picker never quietly means something different from what it says.
   */
  readonly includesChildren?: boolean
}

/**
 * Renders the `<option>`s of a category `<select>`, grouped under their parents.
 *
 * A flat list sorted by name interleaves the two levels, so "Groceries" lands
 * between "Gifts" and "Housing" instead of under "Food". With dozens of
 * categories that makes the dropdown unusable, since the only way to find a
 * child is to already know its name.
 *
 * `<optgroup>` is used because it tells screen readers and native mobile pickers
 * that the options belong to a heading, which a disabled option pretending to be
 * one does not. A top-level category with no children is a plain selectable
 * option, and a parent stays selectable inside its own group. A child whose
 * parent is missing from the list (disabled, filtered or excluded) is shown
 * under "Other" so it never silently vanishes.
 *
 * @example
 * <select>
 *   <CategoryOptions categories={cats} placeholder={{ value: '', label: 'None' }} />
 * </select>
 */
export function CategoryOptions({
  categories, placeholder, exclude, includesChildren = false,
}: CategoryOptionsProps) {
  const groups = useMemo(() => {
    const visible = exclude === undefined
      ? categories
      : categories.filter((c) => !exclude.has(c.id))

    const parents = visible.filter((c) => c.parent_id === null)
    const byParent = new Map<string, GroupableCategory[]>()
    for (const c of visible) {
      if (c.parent_id === null) continue
      const list = byParent.get(c.parent_id) ?? []
      list.push(c)
      byParent.set(c.parent_id, list)
    }

    const parentIds = new Set(parents.map((p) => p.id))
    const orphans = visible.filter((c) => c.parent_id !== null && !parentIds.has(c.parent_id))

    return { parents, byParent, orphans }
  }, [categories, exclude])

  return (
    <>
      {placeholder !== undefined ? (
        <option value={placeholder.value}>{placeholder.label}</option>
      ) : null}

      {groups.parents.map((parent) => {
        const children = groups.byParent.get(parent.id) ?? []
        if (children.length === 0) {
          return <option key={parent.id} value={parent.id}>{parent.name}</option>
        }
        return (
          <optgroup key={parent.id} label={parent.name}>
            <option value={parent.id}>
              {includesChildren ? `All of ${parent.name}` : parent.name}
            </option>
            {children.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </optgroup>
        )
      })}

      {groups.orphans.length > 0 ? (
        <optgroup label="Other">
          {groups.orphans.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </optgroup>
      ) : null}
    </>
  )
}
