import { useState, type FormEvent, type SyntheticEvent } from 'react'
import { createPortal } from 'react-dom'
import { Button, Dialog, FormError, formErrorsFrom, useFormErrors } from '@wickermoney/ui-kit'
import { exportMyData } from '../helpers/exportMyData.js'
import { PasswordConfirmField } from './PasswordConfirmField.js'

/** Props for {@link ExportPasswordDialog}. */
export interface ExportPasswordDialogProps {
  /** Closes the dialog without downloading. */
  readonly onClose: () => void
  /** Runs once the file has been handed to the browser; the caller closes the dialog. */
  readonly onExported: () => void
}

/**
 * The password step before the data export downloads: enter the password,
 * press Download.
 *
 * A wrong password is a message under the password field and keyboard focus
 * goes back to the field, so a screen reader reads the label and the message
 * together; any other refusal (too many attempts, a server error) shows beside
 * the buttons. The dialog stays open for a retry.
 *
 * It is drawn into the page body rather than where it is used. The erase
 * dialogs offer the export from inside their own form, and a form cannot sit
 * inside a form. React still carries events through that portal to the erase
 * dialog's handlers, so two events are stopped here: this form's submit
 * (pressing Enter here must never be able to submit the erase) and the dialog's
 * `close` (React hands it to every ancestor's `onClose`, so Escape on this
 * dialog would otherwise close the erase dialog under it too).
 */
export function ExportPasswordDialog({ onClose, onExported }: ExportPasswordDialogProps) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const { errors, ref, show, clear } = useFormErrors<HTMLFormElement>()

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (busy || password === '') return
    setBusy(true); clear()
    try {
      await exportMyData(password)
    } catch (error) {
      show(formErrorsFrom(error, ['password'], 'Could not export your data.'))
      setBusy(false)
      return
    }
    onExported()
  }

  return createPortal(
    <div {...KEEP_CLOSE_HERE}>
      <Dialog title="Confirm your password" onClose={() => { if (!busy) onClose() }}>
        <form ref={ref} className="password-step" onSubmit={(e) => { void onSubmit(e) }} aria-busy={busy} noValidate>
          <p>
            Enter your password to download a copy of your data. This protects your data if someone
            else gets hold of a browser you are signed in on.
          </p>
          <PasswordConfirmField
            value={password}
            error={errors.fields['password']}
            onChange={(next) => { setPassword(next); clear() }}
            disabled={busy}
          />
          <FormError message={errors.form} />
          <div className="wm-dialog__actions">
            <Button onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={busy || password === ''}>
              {busy ? 'Preparing export…' : 'Download my data'}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>,
    document.body,
  )
}

/**
 * Props for the wrapper around the dialog: ends the React-tree journey of the
 * dialog's `close` event. The DOM event does not bubble; React's copy of it
 * does, so without this an enclosing dialog's `onClose` would run as well.
 */
const KEEP_CLOSE_HERE = { onClose: (e: SyntheticEvent) => { e.stopPropagation() } }
