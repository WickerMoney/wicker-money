/** A debt as stored. Numeric columns are read as text so they never pass through a JavaScript number. */
export interface DebtRow {
  id: string
  name: string
  balance: string
  apr: string
  minimum_payment: string
  account_id: string | null
  sort_order: number
  archived: boolean
}
