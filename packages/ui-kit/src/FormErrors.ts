/**
 * Everything wrong with a form, split by where it is shown.
 *
 * `fields` is keyed by the form's own field names and goes to each control's
 * `error` prop. `form` is whatever is left, shown next to the submit action
 * with {@link FormError}.
 */
export interface FormErrors {
  /** Message per field name. A field with no entry is fine. */
  readonly fields: Readonly<Record<string, string>>
  /** A problem that is not about one field, or `null`. */
  readonly form: string | null
}

/** A form with nothing wrong with it. */
export const NO_FORM_ERRORS: FormErrors = { fields: {}, form: null }

/**
 * Whether a form has anything to show.
 *
 * @param errors - The form's errors.
 * @returns `true` when any field or the form itself has a message.
 */
export function hasFormErrors(errors: FormErrors): boolean {
  return errors.form !== null || Object.keys(errors.fields).length > 0
}
