import { editableMoney, isZeroMoney } from '@wickermoney/plugin-sdk/money'
import type { Debt, DebtDraft } from '../models/index.js'

/**
 * Fills the form from a saved debt.
 *
 * Amounts are shown to the cent (`1000.00`), or with all four places when the
 * saved value has sub-cent precision, so editing never rounds anything away.
 * The rate keeps its four places trimmed of trailing zeros (`24.99`). An
 * earmark of zero is shown blank.
 */
export function draftFromDebt(debt: Debt): DebtDraft {
  return {
    name: debt.name,
    balance: editableMoney(debt.balance),
    apr: debt.apr.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, ''),
    minimumPayment: editableMoney(debt.minimumPayment),
    accountId: debt.accountId ?? '',
    archived: debt.archived,
    included: debt.included,
    // Blank for none, so the field is not a column of zeros.
    extraPayment: isZeroMoney(debt.extraPayment) ? '' : editableMoney(debt.extraPayment),
    repaymentStartsOn: debt.repaymentStartsOn ?? '',
    promoApr: debt.promoApr === null ? '' : debt.promoApr.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, ''),
    promoEndsOn: debt.promoEndsOn ?? '',
    promoDeferredInterest: debt.promoDeferredInterest,
    promoInterestBase: debt.promoInterestBase,
    compounding: debt.compounding,
  }
}
