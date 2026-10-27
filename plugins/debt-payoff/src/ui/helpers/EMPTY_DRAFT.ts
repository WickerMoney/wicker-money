import type { DebtDraft } from '../models/index.js'

/** A blank form. */
export const EMPTY_DRAFT: DebtDraft = {
  name: '', balance: '', apr: '', minimumPayment: '', accountId: '', archived: false, included: true, extraPayment: '',
  repaymentStartsOn: '', promoApr: '', promoEndsOn: '', promoDeferredInterest: false,
  promoInterestBase: 'original', compounding: 'monthly',
}
