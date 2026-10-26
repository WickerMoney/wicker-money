import type { Compounding, PromoInterestBase } from '../../shared/index.js'

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
  included: boolean
  extra_payment: string
  repayment_starts_on: string | null
  promo_apr: string | null
  promo_ends_on: string | null
  promo_deferred_interest: boolean
  promo_interest_base: PromoInterestBase
  compounding: Compounding
  created_at: Date
  updated_at: Date
}
