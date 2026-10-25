import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  Button, Dialog, Field, FormError, SelectField, hasFormErrors, useFormErrors, type FormErrors,
} from '@wickermoney/ui-kit'
import type { AccountSuggestion, Debt, DebtDraft } from '../models/index.js'

/** Props for {@link DebtDialog}. */
export interface DebtDialogProps {
  /** The saved debt being changed, or `null` when adding one. */
  readonly editing: Debt | null
  /** What the form starts with. */
  readonly initial: DebtDraft
  /** Loan and credit card accounts a debt could track. */
  readonly suggestions: readonly AccountSuggestion[]
  /** Whether a change is already being saved. */
  readonly busy: boolean
  /** Saves the form; resolves to the problems by field, or no errors once saved. */
  readonly onSave: (draft: DebtDraft) => Promise<FormErrors>
  /** Removes the debt; resolves to whether it went. Only offered when editing. */
  readonly onRemove: (debt: Debt) => Promise<boolean>
  /** Closes the dialog. Called after a save or removal that worked, and on dismissal. */
  readonly onClose: () => void
}

const ACCOUNT_KINDS: Readonly<Record<string, string>> = { credit_card: 'credit card', loan: 'loan' }

/**
 * The dialog that adds or changes a debt: a side drawer on a desktop window and
 * a full-screen sheet on a phone (the shared `Dialog`).
 *
 * Each problem is shown on the field it belongs to, and focus moves to the
 * first one. Removing a debt asks once, in the dialog, and offers archiving as
 * the way to keep a record.
 */
export function DebtDialog({ editing, initial, suggestions, busy, onSave, onRemove, onClose }: DebtDialogProps) {
  const [draft, setDraft] = useState<DebtDraft>(initial)
  const [confirming, setConfirming] = useState(false)
  const { errors, ref, show, clearField } = useFormErrors<HTMLFormElement>()
  const confirmRef = useRef<HTMLDivElement>(null)
  const removeRef = useRef<HTMLDivElement>(null)
  const wasConfirming = useRef(false)
  const err = (field: string) => errors.fields[field]

  useEffect(() => {
    if (confirming) confirmRef.current?.focus()
    // Backing out of the question puts focus back on the button that asked it.
    else if (wasConfirming.current) removeRef.current?.querySelector('button')?.focus()
    wasConfirming.current = confirming
  }, [confirming])

  const change = (patch: Partial<DebtDraft>, field?: string) => {
    setDraft((d) => ({ ...d, ...patch }))
    if (field !== undefined) clearField(field)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const result = await onSave(draft)
    if (hasFormErrors(result)) show(result)
    else onClose()
  }

  const remove = async () => {
    if (editing !== null && await onRemove(editing)) onClose()
  }

  // An account already tracked by another debt would be refused; leave it out.
  const choices = suggestions.filter((a) => a.debtId === null || a.debtId === editing?.id)
  const known = choices.some((a) => a.id === draft.accountId)

  return (
    <Dialog title={editing === null ? 'Add a debt' : `Edit ${editing.name}`} onClose={onClose}>
      <form onSubmit={(e) => void submit(e)} ref={ref} noValidate>
        <Field
          label="Name"
          value={draft.name}
          autoComplete="off"
          error={err('name')}
          onChange={(e) => change({ name: e.target.value }, 'name')}
        />
        <Field
          label="Balance"
          hint="What you owe today."
          inputMode="decimal"
          autoComplete="off"
          value={draft.balance}
          error={err('balance')}
          onChange={(e) => change({ balance: e.target.value }, 'balance')}
        />
        <Field
          label="Interest rate (% a year)"
          hint="The yearly rate (APR) as a percentage, such as 24.99. Enter 0 if there is none."
          inputMode="decimal"
          autoComplete="off"
          value={draft.apr}
          error={err('apr')}
          onChange={(e) => change({ apr: e.target.value }, 'apr')}
        />
        <Field
          label="Minimum payment (a month)"
          hint="The least the lender asks for each month."
          inputMode="decimal"
          autoComplete="off"
          value={draft.minimumPayment}
          error={err('minimumPayment')}
          onChange={(e) => change({ minimumPayment: e.target.value }, 'minimumPayment')}
        />
        <Field
          label="Extra each month toward this debt (optional)"
          hint="Paid to this debt on top of its minimum, apart from the extra for all debts. It stops when this debt is paid off and does not move to another debt. Leave blank for none."
          inputMode="decimal"
          autoComplete="off"
          value={draft.extraPayment}
          error={err('extraPayment')}
          onChange={(e) => change({ extraPayment: e.target.value }, 'extraPayment')}
        />
        <SelectField
          label="Linked account (optional)"
          hint="Ties this debt to one of your loan or credit card accounts. Its balance is still the one you enter here."
          value={draft.accountId}
          error={err('accountId')}
          onChange={(e) => {
            const picked = choices.find((a) => a.id === e.target.value)
            change(
              { accountId: e.target.value, ...(picked !== undefined && draft.name.trim() === '' ? { name: picked.name } : {}) },
              'accountId',
            )
          }}
        >
          <option value="">Not linked</option>
          {!known && draft.accountId !== '' ? <option value={draft.accountId}>Linked account</option> : null}
          {choices.map((a) => (
            <option key={a.id} value={a.id}>{a.name} ({ACCOUNT_KINDS[a.accountType] ?? a.accountType})</option>
          ))}
        </SelectField>

        <label className="check dp-archive">
          <input
            type="checkbox"
            checked={draft.included && !draft.archived}
            disabled={draft.archived}
            onChange={(e) => change({ included: e.target.checked })}
          />
          <span>
            Include in the payoff plan.{' '}
            {draft.archived
              ? 'An archived debt is never in the plan.'
              : 'Switch it off to keep the debt in your list but leave it out of the dates and totals, such as a mortgage that would dwarf the rest.'}
          </span>
        </label>

        {editing !== null ? (
          <label className="check dp-archive">
            <input
              type="checkbox"
              checked={draft.archived}
              onChange={(e) => change({ archived: e.target.checked })}
            />
            <span>Archive this debt: keep it, but leave it out of the list and the plan.</span>
          </label>
        ) : null}

        <div className="wm-dialog__actions">
          <FormError message={errors.form} />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={busy}>
            {editing === null ? 'Add debt' : 'Save changes'}
          </Button>
        </div>

        {editing !== null ? (
          confirming ? (
            <div className="dp-confirm" role="group" aria-label={`Remove ${editing.name}`} tabIndex={-1} ref={confirmRef}>
              <p>
                Remove {editing.name} for good? To keep a record of it, archive it instead.
              </p>
              <div className="dp-confirm__actions">
                <Button variant="danger" disabled={busy} onClick={() => void remove()}>Yes, remove it</Button>
                <Button onClick={() => setConfirming(false)}>Keep it</Button>
              </div>
            </div>
          ) : (
            <div className="dp-remove" ref={removeRef}>
              <Button variant="danger" onClick={() => setConfirming(true)}>Remove this debt</Button>
            </div>
          )
        ) : null}
      </form>
    </Dialog>
  )
}
