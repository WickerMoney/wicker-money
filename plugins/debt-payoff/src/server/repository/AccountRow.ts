/** A core account, as much of it as the debt service needs. */
export interface AccountRow {
  id: string
  name: string
  account_type: string
  archived: boolean
}

/** A loan or credit card account, with the debt already tracking it if there is one. */
export interface LiabilityAccountRow {
  id: string
  name: string
  account_type: 'credit_card' | 'loan'
  debt_id: string | null
}
