import type { DebtDraft } from '../models/index.js'

/**
 * The request body for a debt form. Text is sent as typed, trimmed: the server
 * parses and normalises it, so the client never turns money into a number. A
 * blank earmark is sent as `'0'`.
 *
 * @param draft - A form that passed {@link checkDraft}.
 * @param editing - Whether this is a change to a saved debt, which may also archive it.
 */
export function draftBody(draft: DebtDraft, editing: boolean): Record<string, unknown> {
  return {
    name: draft.name.trim(),
    balance: draft.balance.trim(),
    apr: draft.apr.trim(),
    minimumPayment: draft.minimumPayment.trim(),
    accountId: draft.accountId === '' ? null : draft.accountId,
    included: draft.included,
    extraPayment: draft.extraPayment.trim() === '' ? '0' : draft.extraPayment.trim(),
    repaymentStartsOn: draft.repaymentStartsOn.trim() === '' ? null : draft.repaymentStartsOn.trim(),
    promoApr: draft.promoApr.trim() === '' ? null : draft.promoApr.trim(),
    promoEndsOn: draft.promoEndsOn.trim() === '' ? null : draft.promoEndsOn.trim(),
    // Deferred interest means nothing without a promotion, so it is not sent on.
    promoDeferredInterest: draft.promoDeferredInterest && draft.promoApr.trim() !== '',
    promoInterestBase: draft.promoInterestBase,
    compounding: draft.compounding,
    ...(editing ? { archived: draft.archived } : {}),
  }
}
