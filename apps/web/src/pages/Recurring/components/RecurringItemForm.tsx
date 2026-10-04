import type { FormEvent, RefObject } from 'react'
import {
  Button, CategoryOptions, Field, FormError, SelectField, Surface, orderByParent, type FormErrors,
} from '@wickermoney/ui-kit'
import { formatDate } from '../../../lib/formatDate.js'
import type { Account, Category, RecurringItem } from '../../../models/index.js'
import { FREQUENCIES, FREQUENCY_LABELS, KINDS, KIND_LABELS } from '../helpers/labels.js'
import { dayLabel } from '../helpers/ordinal.js'
import { previewDates } from '../helpers/previewDates.js'
import type { RecurringDraft } from '../state/RecurringDraft.js'

/** Props for {@link RecurringItemForm}. */
export interface RecurringItemFormProps {
  readonly draft: RecurringDraft
  readonly editing: RecurringItem | null
  /** Active accounts to offer. */
  readonly accounts: readonly Account[]
  readonly categories: readonly Category[]
  /** The server's today; the preview counts from it. */
  readonly today: string
  readonly busy: boolean
  /** What is wrong, by field name (see `checkDraft`), and anything else for beside the button. */
  readonly errors: FormErrors
  /** Attached to the `<form>`, so focus can move to the first problem. */
  readonly formRef?: RefObject<HTMLFormElement | null>
  readonly onChange: (patch: Partial<RecurringDraft>) => void
  readonly onSubmit: () => void
  readonly onCancel: () => void
}

const DAYS = Array.from({ length: 31 }, (_, i) => i + 1)
/** Liability accounts a debt payment can pay. */
const LIABILITIES = new Set(['credit_card', 'loan'])

/**
 * Adds or edits a recurring item, with its legs, and previews the next dates.
 *
 * The fields follow the kind: a bill is one account and an amount, income can
 * be split across accounts, and a transfer or debt payment is from → to. Every
 * amount is typed positive; the kind supplies the sign. The category picker
 * offers only categories of the matching kind, and none for money moving
 * between your own accounts.
 */
export function RecurringItemForm({
  draft, editing, accounts, categories, today, busy, errors, formRef, onChange, onSubmit, onCancel,
}: RecurringItemFormProps) {
  const err = (field: string) => errors.fields[field]
  /** Replaces one income row. */
  const changeSplit = (index: number, patch: Partial<RecurringDraft['splits'][number]>) => {
    onChange({ splits: draft.splits.map((s, i) => (i === index ? { ...s, ...patch } : s)) })
  }
  const submit = (event: FormEvent) => { event.preventDefault(); onSubmit() }
  const preview = previewDates(draft, today)
  const wantedKind = draft.kind === 'income' ? 'income' : 'expense'
  const pickable = orderByParent(categories.filter((c) => c.is_enabled && c.kind === wantedKind))
  const hasCategory = draft.kind === 'income' || draft.kind === 'bill'
  const destinations = draft.kind === 'debt_payment'
    ? accounts.filter((a) => LIABILITIES.has(a.accountType))
    : accounts

  const accountOptions = (list: readonly Account[]) => (
    <>
      <option value="">Choose an account</option>
      {list.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
    </>
  )

  return (
    <Surface title={editing === null ? 'Add a recurring item' : `Edit '${editing.name}'`}>
      <form onSubmit={submit} ref={formRef} noValidate>
        <Field label="Name" required value={draft.name} error={err('name')}
               onChange={(e) => onChange({ name: e.target.value })} />
        <SelectField label="Kind" value={draft.kind}
                     onChange={(e) => onChange({ kind: e.target.value as RecurringDraft['kind'], categoryId: '' })}>
          {KINDS.map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
        </SelectField>

        {draft.kind === 'income' ? (
          <fieldset className="recur-legs">
            <legend className="wm-field__label">Paid into</legend>
            {draft.splits.map((split, index) => (
              <div className="recur-legs__row" key={index}>
                <SelectField label={`Account ${index + 1}`} value={split.accountId}
                             error={err(`splits.${index}.accountId`)}
                             onChange={(e) => changeSplit(index, { accountId: e.target.value })}>
                  {accountOptions(accounts)}
                </SelectField>
                <Field label="Amount" inputMode="decimal" value={split.amount} error={err(`splits.${index}.amount`)}
                       onChange={(e) => changeSplit(index, { amount: e.target.value })} />
                {draft.splits.length > 1 ? (
                  <Button aria-label={`Remove account ${index + 1}`}
                          onClick={() => onChange({ splits: draft.splits.filter((_, i) => i !== index) })}>
                    Remove
                  </Button>
                ) : null}
              </div>
            ))}
            <Button onClick={() => onChange({ splits: [...draft.splits, { accountId: '', amount: '' }] })}>
              Split across another account
            </Button>
          </fieldset>
        ) : (
          <>
            <SelectField label={draft.kind === 'bill' ? 'Paid from' : 'From'} value={draft.fromAccountId}
                         error={err('fromAccountId')}
                         onChange={(e) => onChange({ fromAccountId: e.target.value })}>
              {accountOptions(accounts)}
            </SelectField>
            {draft.kind !== 'bill' ? (
              <SelectField label={draft.kind === 'debt_payment' ? 'Pays (card or loan)' : 'To'} value={draft.toAccountId}
                           error={err('toAccountId')}
                           onChange={(e) => onChange({ toAccountId: e.target.value })}>
                {accountOptions(destinations)}
              </SelectField>
            ) : null}
            <Field label="Amount" inputMode="decimal" value={draft.amount} error={err('amount')}
                   onChange={(e) => onChange({ amount: e.target.value })} />
          </>
        )}

        <SelectField label="How often" value={draft.frequency}
                     onChange={(e) => onChange({ frequency: e.target.value as RecurringDraft['frequency'] })}>
          {FREQUENCIES.map((f) => <option key={f} value={f}>{FREQUENCY_LABELS[f]}</option>)}
        </SelectField>
        {draft.frequency === 'semimonthly' ? (
          <div className="recur-days">
            <SelectField label="First day" value={draft.day1} onChange={(e) => onChange({ day1: e.target.value })}>
              {DAYS.slice(0, 27).map((d) => <option key={d} value={d}>{dayLabel(d)}</option>)}
            </SelectField>
            <SelectField label="Second day" value={draft.day2} error={err('day2')}
                         onChange={(e) => onChange({ day2: e.target.value })}>
              {DAYS.map((d) => <option key={d} value={d}>{dayLabel(d)}</option>)}
            </SelectField>
          </div>
        ) : null}
        <Field label={draft.frequency === 'once' ? 'Date' : 'First date'} type="date" required
               value={draft.seriesStartDate} error={err('seriesStartDate')}
               onChange={(e) => onChange({ seriesStartDate: e.target.value })} />
        {draft.frequency !== 'once' ? (
          <Field label="Last date (optional)" type="date" value={draft.endDate} error={err('endDate')}
                 onChange={(e) => onChange({ endDate: e.target.value })} />
        ) : null}

        {hasCategory ? (
          <SelectField label="Category (optional)" value={draft.categoryId} error={err('categoryId')}
                       onChange={(e) => onChange({ categoryId: e.target.value })}>
            <CategoryOptions categories={pickable} placeholder={{ value: '', label: 'None' }} />
          </SelectField>
        ) : null}

        <div className="recur-preview" aria-live="polite">
          <div className="wm-field__label">Next dates</div>
          {preview === null ? (
            <p className="form-hint">Finish the schedule to see when it lands.</p>
          ) : preview.length === 0 ? (
            <p className="form-hint">Nothing from today on.</p>
          ) : (
            <ul className="recur-preview__list">{preview.map((d) => <li key={d}>{formatDate(d)}</li>)}</ul>
          )}
        </div>

        <div className="page__actions">
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Saving…' : editing === null ? 'Add item' : 'Save changes'}
          </Button>
          {editing !== null ? <Button disabled={busy} onClick={onCancel}>Cancel</Button> : null}
        </div>
        <FormError message={errors.form} />
      </form>
    </Surface>
  )
}
