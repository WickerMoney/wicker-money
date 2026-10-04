import { useId, type InputHTMLAttributes } from 'react'

/** Props for {@link InlineInput}: a native input plus the message to show under it. */
export type InlineInputProps = InputHTMLAttributes<HTMLInputElement> & {
  /** What is wrong with the value, or `undefined`. Marks the input invalid and describes it. */
  readonly error?: string | undefined
}

/**
 * An unlabelled input for editing inside a table row, with its error under it.
 *
 * Table cells have no room for a visible label, so the caller passes
 * `aria-label`; everything else matches ui-kit's `Field`: `aria-invalid`, and
 * the message linked with `aria-describedby` so it is read with the input.
 */
export function InlineInput({ error, className = 'cat-edit', ...rest }: InlineInputProps) {
  const id = useId()
  return (
    <span className="inline-input">
      <input
        className={className}
        aria-invalid={error !== undefined}
        aria-describedby={error !== undefined ? `${id}-error` : undefined}
        {...rest}
      />
      {error !== undefined ? <span className="wm-field__error" id={`${id}-error`}>{error}</span> : null}
    </span>
  )
}
