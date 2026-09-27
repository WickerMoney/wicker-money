import { useId, type InputHTMLAttributes } from 'react'
import type { FieldCommon } from './FieldCommon.js'

/** Props for {@link Field}: the shared field props plus every native `<input>` attribute. */
export type FieldProps = FieldCommon & InputHTMLAttributes<HTMLInputElement>

/** A labelled text input. The label is always associated, never a bare placeholder. */
export function Field({ label, error, ...rest }: FieldProps) {
  const id = useId()
  return (
    <div className="wm-field">
      <label className="wm-field__label" htmlFor={id}>{label}</label>
      <input
        id={id}
        className="wm-field__control"
        aria-invalid={error !== undefined}
        aria-describedby={error !== undefined ? `${id}-error` : undefined}
        {...rest}
      />
      {error !== undefined ? (
        <span className="wm-field__error" id={`${id}-error`}>{error}</span>
      ) : null}
    </div>
  )
}
