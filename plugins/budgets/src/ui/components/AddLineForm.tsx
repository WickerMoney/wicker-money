import { useEffect, useMemo, useState } from 'react'
import { Button, CategoryOptions, SelectField, orderByParent } from '@wickermoney/ui-kit'
import type { Category, MonthLine } from '../models/index.js'

/** Props for {@link AddLineForm}. */
export interface AddLineFormProps {
  readonly categories: readonly Category[]
  /** The lines already in the month, so the picker never offers a duplicate. */
  readonly lines: readonly MonthLine[]
  readonly busy: boolean
  /** Adds a zero-plan line for a category. */
  readonly onAdd: (categoryId: string) => void
}

/**
 * A picker and button that add a budget line for a category that has none this
 * month. Categories are grouped under their parents, as everywhere else in the app.
 */
export function AddLineForm({ categories, lines, busy, onAdd }: AddLineFormProps) {
  const [addCategoryId, setAddCategoryId] = useState('')

  const taken = useMemo(() => new Set(lines.map((l) => l.categoryId)), [lines])
  // In the order the grouped dropdown shows them, so the default is the first option listed.
  const addable = useMemo(
    () => orderByParent(categories.filter((c) => !taken.has(c.id))),
    [categories, taken],
  )

  useEffect(() => {
    setAddCategoryId((current) =>
      current !== '' && addable.some((c) => c.id === current) ? current : (addable[0]?.id ?? ''),
    )
  }, [addable])

  return (
    <div className="bud__add">
      <SelectField
        label="Add a category"
        value={addCategoryId}
        onChange={(e) => setAddCategoryId(e.target.value)}
      >
        <CategoryOptions categories={categories} exclude={taken} />
      </SelectField>
      <Button disabled={busy || addCategoryId === ''} onClick={() => onAdd(addCategoryId)}>
        Add line
      </Button>
    </div>
  )
}
