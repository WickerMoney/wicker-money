import { useEffect, useMemo, useState } from 'react'
import {
  Button, CategoryOptions, Field, FormError, SelectField, hasFormErrors, useFormErrors, type FormErrors,
} from '@wickermoney/ui-kit'
import { editableMoney } from '@wickermoney/plugin-sdk/money'
import type { AccountLine, AccountLineDraft, AccountOption, Category } from '../models/index.js'

/** Props for {@link AccountLineForm}. */
export interface AccountLineFormProps {
  /** Accounts an allowance can be set on. */
  readonly accounts: readonly AccountOption[]
  readonly categories: readonly Category[]
  /** The allowance being edited, or `null` to add a new one. */
  readonly editing: AccountLine | null
  readonly busy: boolean
  /** Checks and saves the allowance. Resolves to its problems, or to none once it is stored. */
  readonly onSave: (draft: AccountLineDraft) => Promise<FormErrors>
  /** Leaves edit mode without saving. */
  readonly onCancel: () => void
}

/**
 * Adds or edits an account's allowance for the month shown: an amount to spend
 * from one account, what is left carrying into next month, and the categories
 * that do not count against it (holiday gifts that have a window of their own,
 * say).
 */
export function AccountLineForm({ accounts, categories, editing, busy, onSave, onCancel }: AccountLineFormProps) {
  const [accountId, setAccountId] = useState('')
  const [planned, setPlanned] = useState('')
  const [rollover, setRollover] = useState(true)
  const [excluded, setExcluded] = useState<readonly string[]>([])
  const [note, setNote] = useState('')
  const [pick, setPick] = useState('')
  const form = useFormErrors<HTMLDivElement>()
  const { clear: clearErrors, clearField } = form

  // Prefill from the allowance being edited, or reset to a blank one. Not keyed
  // on `accounts`: the lists reload after every save, and that must not wipe a
  // form half filled in.
  useEffect(() => {
    if (editing !== null) {
      setAccountId(editing.accountId)
      setPlanned(editableMoney(editing.planned))
      setRollover(editing.rollover)
      setExcluded(editing.excludedCategoryIds)
      setNote(editing.note ?? '')
    } else {
      setPlanned('')
      setRollover(true)
      setExcluded([])
      setNote('')
    }
    setPick('')
    clearErrors()
  }, [editing, clearErrors])

  // Keep the chosen account valid as the list loads or changes.
  useEffect(() => {
    setAccountId((current) =>
      current !== '' && accounts.some((a) => a.id === current) ? current : (accounts[0]?.id ?? ''),
    )
  }, [accounts])

  const names = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories])
  const skipped = useMemo(() => new Set(excluded), [excluded])
  const ready = accountId !== '' && planned.trim() !== ''

  const submit = async () => {
    const errors = await onSave({
      accountId, planned: planned.trim(), rollover, excludedCategoryIds: excluded,
      note: note.trim() === '' ? null : note.trim(),
    })
    form.show(errors)
    const saved = !hasFormErrors(errors)
    if (saved && editing !== null) onCancel()
    else if (saved) { setPlanned(''); setExcluded([]); setNote('') }
  }

  if (accounts.length === 0) {
    return (
      <p className="bud__note">
        An allowance is set on a checking account, and there is none to choose from yet.
      </p>
    )
  }

  return (
    <div className="bud__window-form">
      <h3 className="bud__window-title">
        {editing !== null ? `Edit the ${editing.accountName} allowance` : 'Add an allowance'}
      </h3>
      <div className="bud__add bud__add--aligned" ref={form.ref}>
        <SelectField label="Account" value={accountId} error={form.errors.fields['accountId']}
                     disabled={editing !== null}
                     onChange={(e) => { setAccountId(e.target.value); clearField('accountId') }}>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </SelectField>
        <Field
          label="Allowance"
          inputMode="decimal"
          placeholder="150.00"
          value={planned}
          error={form.errors.fields['planned']}
          onChange={(e) => { setPlanned(e.target.value); clearField('planned') }}
        />
        <SelectField
          label="Don't count"
          value={pick}
          error={form.errors.fields['excludedCategoryIds']}
          onChange={(e) => {
            const id = e.target.value
            if (id !== '') setExcluded((current) => [...current, id])
            setPick('')
            clearField('excludedCategoryIds')
          }}
        >
          <CategoryOptions
            categories={categories}
            exclude={skipped}
            placeholder={{ value: '', label: 'Leave a category out…' }}
          />
        </SelectField>
        <Field label="Note" value={note} maxLength={300} error={form.errors.fields['note']}
               onChange={(e) => { setNote(e.target.value); clearField('note') }} />
        <div className="wm-field bud__add-action">
          <span className="wm-field__label" aria-hidden="true">&nbsp;</span>
          <div className="bud__add-buttons">
            <Button variant="primary" disabled={busy || !ready} onClick={() => void submit()}>
              {editing !== null ? 'Save allowance' : 'Add allowance'}
            </Button>
            {editing !== null ? <Button disabled={busy} onClick={onCancel}>Cancel</Button> : null}
          </div>
        </div>
      </div>
      <label className="check">
        <input type="checkbox" checked={rollover} onChange={(e) => setRollover(e.target.checked)} />
        {' '}Carry what is left into next month
      </label>
      {excluded.length > 0 ? (
        <ul className="bud__chips" aria-label="Categories not counted">
          {excluded.map((id) => (
            <li className="bud__chip" key={id}>
              {names.get(id) ?? 'Removed category'}
              <button
                type="button"
                className="bud__chip-remove"
                aria-label={`Count ${names.get(id) ?? 'this category'} again`}
                onClick={() => setExcluded((current) => current.filter((x) => x !== id))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <FormError message={form.errors.form} />
    </div>
  )
}
