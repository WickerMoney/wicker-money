import { useEffect, useState } from 'react'
import { Button, Field, SelectField } from '@wickermoney/ui-kit'
import { editableMoney, monthPeriod } from '../../shared/index.js'
import type { Category, MonthLine, WindowDraft } from '../models/index.js'

/** Props for {@link WindowForm}. */
export interface WindowFormProps {
  readonly categories: readonly Category[]
  /** The month being shown, `YYYY-MM`; a new window starts on its first day. */
  readonly monthKey: string
  /** The window being edited, or `null` to add a new one. */
  readonly editing: MonthLine | null
  readonly busy: boolean
  /** Saves the window. Resolves `true` once it is stored. */
  readonly onSave: (draft: WindowDraft) => Promise<boolean>
  /** Leaves edit mode without saving. */
  readonly onCancel: () => void
}

/**
 * Adds or edits a window: one amount for one category, spent down between two
 * dates that can cross months, such as holiday gifts from October 1 through
 * December 25.
 *
 * Dates are plain `YYYY-MM-DD` strings from native date inputs, so there is
 * no zone conversion anywhere between the field and the server.
 */
export function WindowForm({ categories, monthKey, editing, busy, onSave, onCancel }: WindowFormProps) {
  const [categoryId, setCategoryId] = useState('')
  const [start, setStart] = useState('')
  const [through, setThrough] = useState('')
  const [planned, setPlanned] = useState('')
  const [note, setNote] = useState('')

  // Prefill from the window being edited, or reset to a blank window starting
  // this month. Deliberately not keyed on `categories`: the list is reloaded
  // after every save, and that must not wipe a window half typed in.
  useEffect(() => {
    if (editing?.window != null) {
      setCategoryId(editing.categoryId)
      setStart(editing.window.start)
      setThrough(editing.window.through)
      setPlanned(editableMoney(editing.window.funded))
      setNote(editing.note ?? '')
    } else {
      setStart(monthPeriod(monthKey).start)
      setThrough('')
      setPlanned('')
      setNote('')
    }
  }, [editing, monthKey])

  // Default the category to the first one, and keep the choice valid if the list changes.
  useEffect(() => {
    setCategoryId((current) =>
      current !== '' && categories.some((c) => c.id === current) ? current : (categories[0]?.id ?? ''),
    )
  }, [categories])

  const ready = categoryId !== '' && start !== '' && through !== '' && planned.trim() !== ''

  const submit = async () => {
    const saved = await onSave({
      id: editing?.id ?? null,
      categoryId,
      start,
      through,
      planned: planned.trim(),
      note: note.trim() === '' ? null : note.trim(),
    })
    if (saved && editing !== null) onCancel()
    else if (saved) { setThrough(''); setPlanned(''); setNote('') }
  }

  return (
    <div className="bud__window-form">
      <h3 className="bud__window-title">
        {editing !== null ? `Edit the ${editing.categoryName} window` : 'Add a window'}
      </h3>
      <p className="bud__note">
        A window is one amount spent down across a date range, like holiday gifts from October 1
        through December 25. It is funded once, and each month shows what is left.
      </p>
      <div className="bud__add">
        <SelectField label="Category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </SelectField>
        <Field label="From" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        <Field label="Through" type="date" value={through} min={start} onChange={(e) => setThrough(e.target.value)} />
        <Field
          label="Amount"
          inputMode="decimal"
          placeholder="1500.00"
          value={planned}
          onChange={(e) => setPlanned(e.target.value)}
        />
        <Field label="Note" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
        <Button variant="primary" disabled={busy || !ready} onClick={() => void submit()}>
          {editing !== null ? 'Save window' : 'Add window'}
        </Button>
        {editing !== null ? <Button disabled={busy} onClick={onCancel}>Cancel</Button> : null}
      </div>
    </div>
  )
}
