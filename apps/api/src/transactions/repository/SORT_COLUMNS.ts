/**
 * Maps the public sort keys onto the `core.transactions` column each one orders
 * by. Keeping this a closed lookup means a caller can never name an arbitrary
 * column.
 */
export const SORT_COLUMNS = {
  date: 'transaction_date',
  amount: 'amount',
  merchant: 'merchant',
} as const
