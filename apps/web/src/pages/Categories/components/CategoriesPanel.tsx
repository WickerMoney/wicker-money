import { useMemo, useState } from 'react'
import { EmptyState, Spinner, Surface, Table, orderByParent } from '@wickermoney/ui-kit'
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
}

/**
 * The category table, with inline rename, re-parent, enable/disable and delete.
 *
 * Rows are ordered parent-then-children with the same helper the pickers use, so
 * a list and a dropdown can never disagree about where a category sits. Disabled
 * categories are hidden unless asked for, since disabling exists to get them out
 * of the way.
 */
export function CategoriesPanel({ categories, parents, status, onChanged }: CategoriesPanelProps) {
  const [showDisabled, setShowDisabled] = useState(false)
  const row = useCategoryEditing(status, onChanged)

  const ordered = useMemo(() => {
    if (categories === null) return null
    const visible = showDisabled ? categories : categories.filter((c) => c.is_enabled)
    return orderByParent(visible)
  }, [categories, showDisabled])

  const disabledCount = useMemo(
    () => (categories ?? []).filter((c) => !c.is_enabled).length,
    [categories],
  )

  const busy = status.busy

  return (
    <Surface title="Categories">
      {ordered === null ? <Spinner /> : (
        <>
          <ShowDisabledToggle count={disabledCount} checked={showDisabled} onChange={setShowDisabled} />

          <Table
            columns={[
              { key: 'name', header: 'Name',
                render: (c: Category) => <CategoryNameCell category={c} row={row} /> },
              { key: 'parent', header: 'Under',
                render: (c: Category) => (
                  <CategoryParentCell category={c} row={row} categories={categories} parents={parents} />
                ) },
              { key: 'kind', header: 'Counts as',
                render: (c: Category) => <CategoryKindCell category={c} row={row} /> },
              { key: 'slug', header: 'Slug',
                render: (c: Category) => <span className="fio-muted">{c.slug}</span> },
              { key: 'actions', header: '',
                render: (c: Category) => <CategoryActionsCell category={c} row={row} busy={busy} /> },
            ]}
            rows={ordered}
            rowKey={(c) => c.id}
            empty={<EmptyState title="No categories yet" hint="Add the starter set above, or create one by hand." />}
          />

          <CategoriesHelp />
        </>
      )}
    </Surface>
  )
}
