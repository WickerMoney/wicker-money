import { useId, type ReactNode, type SelectHTMLAttributes } from 'react'
import type { FieldCommon } from './FieldCommon.js'

/** Props for {@link SelectField}: the shared field props plus every native `<select>` attribute. */
export type SelectFieldProps = FieldCommon &
  SelectHTMLAttributes<HTMLSelectElement> & {
    /** The `<option>` and `<optgroup>` elements to choose between. */
    readonly children: ReactNode
  }

/** A labelled `<select>`. The label is always associated with the control. */
export function SelectField({ label, error, children, ...rest }: SelectFieldProps) {
  const id = useId()
  return (
    <div className="fio-field">
      <label className="fio-field__label" htmlFor={id}>{label}</label>
      <select id={id} className="fio-field__control" aria-invalid={error !== undefined} {...rest}>
        {children}
      </select>
      {error !== undefined ? <span className="fio-field__error">{error}</span> : null}
    </div>
  )
}
