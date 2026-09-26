/** Where a named constraint stands: absent, present but unchecked against existing rows, or fully validated. */
export type ConstraintValidity = 'missing' | 'not_validated' | 'valid'
