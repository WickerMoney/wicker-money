import { useMemo, useState } from 'react'
import { Button, EmptyState, Spinner, Surface, Table, orderByParent } from '@wickermoney/ui-kit'
import { useExpandedGroups, type ExpandedGroups } from '../../../disclosure/index.js'
import type { ActionStatus } from '../../../hooks/useActionStatus.js'
import type { Category } from '../../../models/index.js'
import { useCategoryEditing } from '../hooks/useCategoryEditing.js'
import { CategoriesHelp } from './CategoriesHelp.js'
import { CategoryActionsCell } from './CategoryActionsCell.js'
import { CategoryKindCell } from './CategoryKindCell.js'
import { CategoryNameCell } from './CategoryNameCell.js'
import { CategoryParentCell } from './CategoryParentCell.js'
import { ShowDisabledToggle } from './ShowDisabledToggle.js'

/** Props for {@link CategoriesPanel}. */
export interface CategoriesPanelProps {
  /** `null` while the first load is in flight. */
  readonly categories: readonly Category[] | null
  /** Top-level categories, the only legal parents. */
  readonly parents: readonly Category[]
  /** Busy flag and error message shared with the page. */
  readonly status: ActionStatus
  /** Called after any change so the list can be re-read. */
  readonly onChanged: () => Promise<void>
  /**
   * Which parents are open, when the page needs to open one itself (after
   * adding a child). The panel keeps its own state when this is omitted.
   */
  readonly groups?: ExpandedGroups
}

/**
 * The category table, with inline rename, re-parent, enable/disable and delete.
 *
 * Rows are ordered parent-then-children with the same helper the pickers use, so
 * a list and a dropdown can never disagree about where a category sits. Each
 * parent is an accordion: its children are listed only while it is open, so a
 * full starter set is a dozen rows rather than sixty. Parents and children stay
 * in one table, so the columns line up whether a group is open or not. Disabled
 * categories are hidden unless asked for, since disabling exists to get them out
 * of the way.
 */
export function CategoriesPanel({ categories, parents, status, onChanged, groups: given }: CategoriesPanelProps) {
  const [showDisabled, setShowDisabled] = useState(false)
  const ownGroups = useExpandedGroups()
  const groups = given ?? ownGroups
  const row = useCategoryEditing(status, onChanged, groups.expand)

  const ordered = useMemo(() => {
    if (categories === null) return null
    const visible = showDisabled ? categories : categories.filter((c) => c.is_enabled)
    return orderByParent(visible)
  }, [categories, showDisabled])

  /** How many children each listed parent has, for the arrow and the count. */
  const childCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const c of ordered ?? []) {
      if (c.parent_id !== null) counts.set(c.parent_id, (counts.get(c.parent_id) ?? 0) + 1)
    }
    return counts
  }, [ordered])

  /** The rows on screen: every parent, and the children of the open ones. */
  const rows = useMemo(() => {
    if (ordered === null) return null
    const parentIds = new Set(ordered.filter((c) => c.parent_id === null).map((c) => c.id))
    // A child whose parent is not listed (a disabled parent while disabled ones
    // are hidden) has no arrow to open it, so it is always shown.
    return ordered.filter(
      (c) => c.parent_id === null || !parentIds.has(c.parent_id) || groups.isOpen(c.parent_id),
    )
  }, [ordered, groups])

  const expandableIds = useMemo(() => [...childCounts.keys()], [childCounts])

  const disabledCount = useMemo(
    () => (categories ?? []).filter((c) => !c.is_enabled).length,
    [categories],
  )

  const busy = status.busy

  return (
    <Surface title="Categories">
      {rows === null ? <Spinner /> : (
        <>
          <div className="acc-toolbar">
            <ShowDisabledToggle count={disabledCount} checked={showDisabled} onChange={setShowDisabled} />
            {expandableIds.length > 0 ? (
              <div className="acc-toolbar__actions">
                <Button onClick={() => groups.expandAll(expandableIds)}>Expand all</Button>
                <Button onClick={groups.collapseAll}>Collapse all</Button>
              </div>
            ) : null}
          </div>

          <div className="cat-table tbl-cards">
            <Table
              caption="Categories"
              columns={[
                { key: 'name', header: 'Name',
                  render: (c: Category) => (
                    <CategoryNameCell
                      category={c}
                      row={row}
                      group={c.parent_id === null
                        ? {
                          count: childCounts.get(c.id) ?? 0,
                          expanded: groups.isOpen(c.id),
                          onToggle: () => groups.toggle(c.id),
                        }
                        : undefined}
                    />
                  ) },
                { key: 'parent', header: 'Under',
                  render: (c: Category) => (
                    <CategoryParentCell category={c} row={row} categories={categories} parents={parents} />
                  ) },
                { key: 'kind', header: 'Counts as',
                  render: (c: Category) => <CategoryKindCell category={c} row={row} /> },
                { key: 'slug', header: 'Slug',
                  render: (c: Category) => <span className="wm-muted">{c.slug}</span> },
                { key: 'actions', header: '',
                  render: (c: Category) => <CategoryActionsCell category={c} row={row} busy={busy} /> },
              ]}
              rows={rows}
              rowKey={(c) => c.id}
              empty={<EmptyState title="No categories yet" hint="Add the starter set above, or create one by hand." />}
            />
          </div>

          <CategoriesHelp />
        </>
      )}
    </Surface>
  )
}
