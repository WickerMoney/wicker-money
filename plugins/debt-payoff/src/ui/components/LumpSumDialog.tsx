import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Button, Dialog, FormError, hasFormErrors, useFormErrors, type FormErrors } from '@wickermoney/ui-kit'
import type { Debt, LumpSum, LumpSumDraft } from '../models/index.js'
import { LumpSumFields } from './LumpSumFields.js'

/** Props for {@link LumpSumDialog}. */
export interface LumpSumDialogProps {
  /** The saved lump sum being changed, or `null` when adding one. */
  readonly editing: LumpSum | null
  readonly initial: LumpSumDraft
  /** The debts a part can be aimed at. */
  readonly debts: readonly Debt[]
  readonly busy: boolean
  /** Saves the form; resolves to the problems by field, or no errors once saved. */
  readonly onSave: (draft: LumpSumDraft) => Promise<FormErrors>
  /** Removes the lump sum; resolves to whether it went. Only offered when editing. */
  readonly onRemove: (lump: LumpSum) => Promise<boolean>
  readonly onClose: () => void
}

/**
 * The dialog that adds or changes a lump sum, with the same shape as the debt
 * dialog: a problem is shown on the field it belongs to and focus moves to the
 * first one; removing asks once, inside the dialog.
 */
export function LumpSumDialog({ editing, initial, debts, busy, onSave, onRemove, onClose }: LumpSumDialogProps) {
  const [draft, setDraft] = useState<LumpSumDraft>(initial)
  const [confirming, setConfirming] = useState(false)
  const { errors, ref, show, clearField } = useFormErrors<HTMLFormElement>()
  const confirmRef = useRef<HTMLDivElement>(null)
  const removeRef = useRef<HTMLDivElement>(null)
  const wasConfirming = useRef(false)

  useEffect(() => {
    if (confirming) confirmRef.current?.focus()
    else if (wasConfirming.current) removeRef.current?.querySelector('button')?.focus()
    wasConfirming.current = confirming
  }, [confirming])

  const change = (patch: Partial<LumpSumDraft>, field?: string) => {
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

  return (
    <Dialog title={editing === null ? 'Add a lump sum' : 'Edit lump sum'} onClose={onClose}>
      <form onSubmit={(e) => void submit(e)} ref={ref} noValidate>
        <LumpSumFields
          draft={draft}
          debts={debts}
          error={(f) => errors.fields[f]}
          onChange={change}
          withNote
        />
        <div className="wm-dialog__actions">
          <FormError message={errors.form} />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" busy={busy}>
            {editing === null ? 'Add lump sum' : 'Save changes'}
          </Button>
        </div>
        {editing !== null ? (
          confirming ? (
            <div className="dp-confirm" role="group" aria-label="Remove this lump sum" tabIndex={-1} ref={confirmRef}>
              <p>Remove this lump sum for good?</p>
              <div className="dp-confirm__actions">
                <Button variant="danger" busy={busy} onClick={() => void remove()}>Yes, remove it</Button>
                <Button onClick={() => setConfirming(false)}>Keep it</Button>
              </div>
            </div>
          ) : (
            <div className="dp-remove" ref={removeRef}>
              <Button variant="danger" onClick={() => setConfirming(true)}>Remove this lump sum</Button>
            </div>
          )
        ) : null}
      </form>
    </Dialog>
  )
}
