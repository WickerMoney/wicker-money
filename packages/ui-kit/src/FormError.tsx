/** Props for {@link FormError}. */
export interface FormErrorProps {
  /** The message, or `null` to render nothing. */
  readonly message: string | null
}

/**
 * A form's own error, for problems that are not about one field.
 *
 * Place it beside the submit button, not at the top of the page: that is
 * where the person is looking when the form refuses. {@link useFormErrors}
 * moves focus here when there is no field to focus instead, which also
 * scrolls it into view.
 */
export function FormError({ message }: FormErrorProps) {
  if (message === null) return null
  return <p className="wm-form-error" role="alert" tabIndex={-1}>{message}</p>
}
