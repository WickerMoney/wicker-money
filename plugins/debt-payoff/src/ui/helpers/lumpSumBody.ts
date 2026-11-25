import type { LumpSumDraft } from '../models/index.js'

/** The parts of a form that are filled in, in the order the debts are listed. */
function filledParts(draft: LumpSumDraft, debtOrder: readonly string[]): Array<{ debtId: string; amount: string }> {
  const known = new Set(debtOrder)
  const ids = [...debtOrder, ...Object.keys(draft.allocations).filter((id) => !known.has(id))]
  return ids.flatMap((debtId) => {
    const amount = (draft.allocations[debtId] ?? '').trim()
    return amount === '' ? [] : [{ debtId, amount }]
  })
}

/**
 * The request body for a lump sum form. Text is sent as typed, trimmed: the
 * server parses and normalises it, so the client never turns money into a
 * number. A part left blank is not sent.
 *
 * @param draft - A form that passed {@link checkLumpSumDraft}.
 * @param debtOrder - The debts' ids in the order they are listed, which orders the parts.
 */
export function lumpSumBody(draft: LumpSumDraft, debtOrder: readonly string[]): Record<string, unknown> {
  return {
    onDate: draft.onDate.trim(),
    amount: draft.amount.trim(),
    note: draft.note.trim(),
    allocations: filledParts(draft, debtOrder),
  }
}

/** The body of a what-if: the same lump sum without its note. */
export function whatIfBody(draft: LumpSumDraft, debtOrder: readonly string[]): Record<string, unknown> {
  const body = { ...lumpSumBody(draft, debtOrder) }
  delete body['note']
  return body
}
