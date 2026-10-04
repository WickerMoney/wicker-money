import { useEffect, useState } from 'react'
import {
  Button, CategoryOptions, Field, FormError, SelectField, hasFormErrors, orderByParent, useFormErrors,
  type FormErrors,
} from '@wickermoney/ui-kit'
import { editableMoney } from '@wickermoney/plugin-sdk/money'
import { monthPeriod } from '../../shared/index.js'
import type { Category, MonthLine, WindowDraft } from '../models/index.js'

/** Props for {@link WindowForm}. */
export interface WindowFormProps {
  readonly categories: readonly Category[]
  /** The month being shown, `YYYY-MM`; a new window starts on its first day. */
  readonly monthKey: string
  /** The window being edited, or `null` to add a new one. */
  readonly editing: MonthLine | null
  readonly busy: boolean
  /** Checks and saves the window. Resolves to its problems, or to none once it is stored. */
  readonly onSave: (draft: WindowDraft) => Promise<FormErrors>
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
  const form = useFormErrors<HTMLDivElement>()
  const { clear: clearErrors, clearField } = form

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
    clearErrors()
  }, [editing, monthKey, clearErrors])

  // Default the category to the first one the grouped dropdown lists, and keep
  // the choice valid if the list changes.
  useEffect(() => {
    setCategoryId((current) =>
      current !== '' && categories.some((c) => c.id === current)
        ? current
        : (orderByParent(categories)[0]?.id ?? ''),
    )
  }, [categories])

  const ready = categoryId !== '' && start !== '' && through !== '' && planned.trim() !== ''

  const submit = async () => {
    const errors = await onSave({
      id: editing?.id ?? null,
      categoryId,
      start,
      through,
      planned: planned.trim(),
      note: note.trim() === '' ? null : note.trim(),
    })
    form.show(errors)
    const saved = !hasFormErrors(errors)
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
      <div className="bud__add" ref={form.ref}>
        <SelectField label="Category" value={categoryId} error={form.errors.fields['categoryId']}
                     onChange={(e) => { setCategoryId(e.target.value); clearField('categoryId') }}>
          <CategoryOptions categories={categories} />
        </SelectField>
        <Field label="From" type="date" value={start} error={form.errors.fields['start']}
               onChange={(e) => { setStart(e.target.value); clearField('start') }} />
        <Field label="Through" type="date" value={through} min={start} error={form.errors.fields['through']}
               onChange={(e) => { setThrough(e.target.value); clearField('through') }} />
        <Field
          label="Amount"
          inputMode="decimal"
          placeholder="1500.00"
          hint="0 is allowed: a window with nothing set aside yet."
          value={planned}
          error={form.errors.fields['planned']}
          onChange={(e) => { setPlanned(e.target.value); clearField('planned') }}
        />
        <Field label="Note" value={note} maxLength={300} error={form.errors.fields['note']}
               onChange={(e) => { setNote(e.target.value); clearField('note') }} />
        <Button variant="primary" disabled={busy || !ready} onClick={() => void submit()}>
          {editing !== null ? 'Save window' : 'Add window'}
        </Button>
        {editing !== null ? <Button disabled={busy} onClick={onCancel}>Cancel</Button> : null}
      </div>
      <FormError message={form.errors.form} />
    </div>
  )
}
