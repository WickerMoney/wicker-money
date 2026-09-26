/**
 * The SQL type each sort column's cursor value is cast to, so the value
 * (carried as text) is compared as a date, a number or a string rather than
 * as an untyped literal.
 */
export const SORT_CASTS = {
  date: 'date',
  amount: 'numeric',
  merchant: 'text',
} as const
