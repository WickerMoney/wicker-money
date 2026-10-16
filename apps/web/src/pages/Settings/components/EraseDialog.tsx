import { useState, type FormEvent, type ReactNode } from 'react'
import {
  Button, Dialog, Field, FormError, NO_FORM_ERRORS, formErrorsFrom, type FormErrors,
} from '@wickermoney/ui-kit'
import { matchesPhrase } from '../helpers/matchesPhrase.js'
import { PasswordConfirmField } from './PasswordConfirmField.js'

/** Props for {@link EraseDialog}. */
export interface EraseDialogProps {
  /** Dialog heading and accessible name. */
  readonly title: string
  /** The words to type to confirm. */
  readonly phrase: string
  /** Label of the destructive button. */
  readonly confirmLabel: string
  /** Closes the dialog without erasing. */
  readonly onClose: () => void
  /**
   * Sends the erase. Rejects with an `ApiError` when the server refuses; the
   * message lands under the field it names, or beside the button.
   */
  readonly submit: (input: { password: string; confirmation: string }) => Promise<void>
  /** Runs once the erase has succeeded; signs the person out. */
  readonly onErased: () => Promise<void>
  /** `false` while something else must be settled first (an acknowledgement, a blocker, a preflight still loading). */
  readonly ready?: boolean
  /** What is about to be deleted, and anything to do before confirming. */
  readonly children?: ReactNode
}

/**
 * The confirmation form shared by both erase actions: type the phrase, enter
 * the password, press the red button.
 *
 * The button stays off until the phrase is right and a password is entered, but
 * the server checks both again and is the authority. A wrong password is a
 * message under the password field, and the dialog stays open.
 */
export function EraseDialog({ title, phrase, confirmLabel, onClose, submit, onErased, ready = true, children }: EraseDialogProps) {
  const [password, setPassword] = useState('')
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<FormErrors>(NO_FORM_ERRORS)

  const canSubmit = ready && !busy && password !== '' && matchesPhrase(typed, phrase)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setBusy(true); setErrors(NO_FORM_ERRORS)
    try {
      await submit({ password, confirmation: typed })
    } catch (error) {
      setErrors(formErrorsFrom(error, ['password', 'confirmation'], 'Could not erase.'))
      setBusy(false)
      return
    }
    // Everything is gone and the session with it. Signing out swaps this whole
    // screen for the sign-in page, so there is nothing left to re-enable.
    try {
      await onErased()
    } catch {
      // The server has already ended the session; a failed logout call changes nothing.
    }
  }

  return (
    <Dialog title={title} onClose={() => { if (!busy) onClose() }}>
      <form className="erase-form" onSubmit={(e) => { void onSubmit(e) }} aria-busy={busy} noValidate>
        {children}
        <Field
          label={`Type "${phrase}" to confirm`}
          name="confirmation"
          value={typed}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          error={errors.fields['confirmation']}
          onChange={(e) => { setTyped(e.target.value); setErrors(NO_FORM_ERRORS) }}
          disabled={busy}
        />
        <PasswordConfirmField
          value={password}
          error={errors.fields['password']}
          onChange={(next) => { setPassword(next); setErrors(NO_FORM_ERRORS) }}
          disabled={busy}
        />
        <FormError message={errors.form} />
        <div className="wm-dialog__actions">
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="danger" disabled={!canSubmit}>
            {busy ? 'Erasing…' : confirmLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
