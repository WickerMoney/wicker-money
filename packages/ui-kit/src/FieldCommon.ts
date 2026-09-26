/** Props shared by every labelled form control. */
export interface FieldCommon {
  /** Visible label, always associated with the control. */
  readonly label: string
  /** Validation message shown under the control. Also marks the control invalid. */
  readonly error?: string
}
