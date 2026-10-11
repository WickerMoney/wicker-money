import type { DebtDraft } from '../models/index.js'

/**
 * The request body for a debt form. Text is sent as typed, trimmed: the server
 * parses and normalises it, so the client never turns money into a number.
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
    ...(editing ? { archived: draft.archived } : {}),
  }
}
