import { useCallback, useMemo, useState } from 'react'

/** Which groups of an accordion-style list are open. See {@link useExpandedGroups}. */
export interface ExpandedGroups {
  /** Whether the group is open. */
  readonly isOpen: (id: string) => boolean
  /** Opens a closed group and closes an open one. */
  readonly toggle: (id: string) => void
  /** Opens one group, leaving the others as they are. Does nothing if it is already open. */
  readonly expand: (id: string) => void
  /** Opens exactly the given groups. */
  readonly expandAll: (ids: readonly string[]) => void
  /** Closes every group. */
  readonly collapseAll: () => void
}

/**
 * Open/closed state for a list of collapsible groups.
 *
 * Everything starts closed: these lists exist to stop a long page from running
 * on, and an expand-by-default list would only defer that until the first
 * reload. State is keyed by id, so it survives the list being re-read after an
 * edit.
 */
export function useExpandedGroups(): ExpandedGroups {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set())

  const isOpen = useCallback((id: string) => open.has(id), [open])
  const toggle = useCallback((id: string) => {
    setOpen((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }, [])
  const expand = useCallback((id: string) => {
    setOpen((current) => (current.has(id) ? current : new Set(current).add(id)))
  }, [])
  const expandAll = useCallback((ids: readonly string[]) => setOpen(new Set(ids)), [])
  const collapseAll = useCallback(() => setOpen(new Set()), [])

  return useMemo(
    () => ({ isOpen, toggle, expand, expandAll, collapseAll }),
    [isOpen, toggle, expand, expandAll, collapseAll],
  )
}
