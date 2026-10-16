import { Field } from '@wickermoney/ui-kit'

/** Props for {@link PasswordConfirmField}. */
export interface PasswordConfirmFieldProps {
  /** What has been typed. */
  readonly value: string
  /** Called with the new text on every change. */
  readonly onChange: (value: string) => void
  /** The server's message about this field, shown beneath it and linked to it for screen readers. */
  readonly error: string | undefined
  /** `true` while a request is in flight. */
  readonly disabled?: boolean
}

/**
 * The "Your password" box every action that asks for the password again uses:
 * the erase dialogs and the export. One component, so the label, the
 * `current-password` hint that lets a password manager fill it, and the way an
 * error attaches to the field are the same wherever the question is asked.
 * The server's `password` issue goes in `error`.
 */
export function PasswordConfirmField({ value, onChange, error, disabled }: PasswordConfirmFieldProps) {
  return (
    <Field
      label="Your password"
      name="password"
      type="password"
      value={value}
      autoComplete="current-password"
      error={error}
      onChange={(e) => { onChange(e.target.value) }}
      disabled={disabled}
    />
  )
}
