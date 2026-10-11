/** A debt row as the data export writes it, timestamps included. */
export interface ExportedDebt {
  id: string
  name: string
  balance: string
  apr: string
  minimum_payment: string
  account_id: string | null
  sort_order: number
  archived: boolean
  created_at: Date
  updated_at: Date
}
