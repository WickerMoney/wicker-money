import type { Compounding, PromoInterestBase } from '../../shared/index.js'

/** What a debt is created with. Amounts are already validated, normalised decimal strings. */
export interface NewDebtInput {
  readonly name: string
  readonly balance: string
  readonly apr: string
  readonly minimumPayment: string
  readonly accountId?: string | null
  /** Defaults to after the last debt. */
  readonly sortOrder?: number
  readonly archived?: boolean
  /** Defaults to `true`. */
  readonly included?: boolean
  /** Defaults to `'0'`. Already validated, normalised. */
  readonly extraPayment?: string
  /** Defaults to `null` (repayment has begun). `YYYY-MM-DD`. */
  readonly repaymentStartsOn?: string | null
  /** Defaults to `null` (no promotion). Sent with `promoEndsOn` or not at all. */
  readonly promoApr?: string | null
  readonly promoEndsOn?: string | null
  /** Defaults to `false`. Needs a promotion. */
  readonly promoDeferredInterest?: boolean
  /** Defaults to `'original'`. */
  readonly promoInterestBase?: PromoInterestBase
  /** Defaults to `'monthly'`. */
  readonly compounding?: Compounding
}

/** The fields of a debt that can be changed; any not sent keep their value. */
export interface DebtChanges {
  readonly name?: string
  readonly balance?: string
  readonly apr?: string
  readonly minimumPayment?: string
  readonly accountId?: string | null
  readonly sortOrder?: number
  readonly archived?: boolean
  readonly included?: boolean
  readonly extraPayment?: string
  readonly repaymentStartsOn?: string | null
  readonly promoApr?: string | null
  readonly promoEndsOn?: string | null
  readonly promoDeferredInterest?: boolean
  readonly promoInterestBase?: PromoInterestBase
  readonly compounding?: Compounding
}
