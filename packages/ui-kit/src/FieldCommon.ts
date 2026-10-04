/** Props shared by every labelled form control. */
export interface FieldCommon {
  /** Visible label, always associated with the control. */
  readonly label: string
  /** Validation message shown under the control. Also marks the control invalid. */
  readonly error?: string
  /** A short note under the control, such as what an empty value means. Read with the control. */
  readonly hint?: string
}

/**
 * The ids a control is described by: its hint, then its error.
 *
 * @param id - The control's id.
 * @param hint - The hint, if there is one.
 * @param error - The error, if there is one.
 * @returns The `aria-describedby` value, or `undefined` when there is nothing.
 */
export function describedBy(id: string, hint: string | undefined, error: string | undefined): string | undefined {
  const ids = [hint !== undefined ? `${id}-hint` : null, error !== undefined ? `${id}-error` : null]
    .filter((x): x is string => x !== null)
  return ids.length > 0 ? ids.join(' ') : undefined
}
