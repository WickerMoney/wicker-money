import type { RecurringOccurrence, RecurringItem } from '../../../models/index.js'

/** The "change this one" form for one occurrence. Amounts are typed as positive magnitudes. */
export interface OverrideDraft {
  readonly nominalDate: string
  readonly expectedDate: string
  /** Magnitude per account; a transfer or debt payment uses one shared field under `'*'`. */
  readonly amounts: Readonly<Record<string, string>>
}

/** Key of the single amount field a two-sided item uses. */
export const SHARED_AMOUNT = '*'

/** Whether an item's legs move one amount between two accounts. */
function twoSided(item: RecurringItem): boolean {
  return item.kind === 'transfer' || item.kind === 'debt_payment'
}

/** A positive magnitude from a signed amount, trimmed of trailing zeros past cents. */
function magnitude(amount: string): string {
  const plain = amount.replace(/^-/, '')
  return plain.replace(/(\.\d\d)0+$/, '$1')
}

/**
 * Starts the form from an occurrence as it stands.
 *
 * @param item - The item.
 * @param occurrence - The occurrence.
 * @returns The draft.
 */
export function overrideDraftFrom(item: RecurringItem, occurrence: RecurringOccurrence): OverrideDraft {
  const amounts: Record<string, string> = {}
  if (twoSided(item)) {
    amounts[SHARED_AMOUNT] = magnitude(occurrence.amount)
  } else {
    for (const leg of occurrence.legs) amounts[leg.accountId] = magnitude(leg.amount)
  }
  return { nominalDate: occurrence.nominalDate, expectedDate: occurrence.expectedDate, amounts }
}

/**
 * Builds the `PUT .../occurrences/:date` body from the form, giving each
 * amount its leg's sign. Validation beyond "is it a positive number" is the
 * server's.
 *
 * @param item - The item.
 * @param draft - The form.
 * @returns The body, or an error to show.
 */
export function overridePayload(
  item: RecurringItem,
  draft: OverrideDraft,
): { payload: { expectedDate: string | null; legs: { accountId: string; amount: string }[] } } | { error: string } {
  const legs: { accountId: string; amount: string }[] = []
  for (const leg of item.legs) {
    const typed = (twoSided(item) ? draft.amounts[SHARED_AMOUNT] : draft.amounts[leg.accountId])?.trim() ?? ''
    if (!/^\d+(\.\d{1,4})?$/.test(typed) || /^0+(\.0+)?$/.test(typed)) {
      return { error: 'Enter each amount as a positive number, like 125.50.' }
    }
    legs.push({ accountId: leg.accountId, amount: leg.amount.startsWith('-') ? `-${typed}` : typed })
  }
  const expectedDate = draft.expectedDate === draft.nominalDate || draft.expectedDate === '' ? null : draft.expectedDate
  return { payload: { expectedDate, legs } }
}
