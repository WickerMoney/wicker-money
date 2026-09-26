import { SelectField } from '@wickermoney/ui-kit'

/** Props for {@link ColumnSelect}. */
export interface ColumnSelectProps {
  readonly label: string
  /** The file's header names, offered as the choices. */
  readonly headers: readonly string[]
  readonly value: string | undefined
  readonly onChange: (next: string) => void
  /** Marks the label with `*` and words the empty option as a prompt rather than "not in this file". */
  readonly required?: boolean
}

/** A column dropdown, with "not in this file" as an explicit choice. */
export function ColumnSelect({ label, headers, value, onChange, required = false }: ColumnSelectProps) {
  return (
    <SelectField
      label={required ? `${label} *` : label}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{required ? '— choose a column —' : '— not in this file —'}</option>
      {headers.map((h) => (
        <option key={h} value={h}>{h}</option>
      ))}
    </SelectField>
  )
}
