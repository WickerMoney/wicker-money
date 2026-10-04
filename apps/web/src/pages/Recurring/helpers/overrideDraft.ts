import { hasFormErrors, type FormErrors } from '@wickermoney/ui-kit'
import { checkMoney, fieldErrors } from '../../../lib/fieldChecks.js'
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

/** What the API says about a zero amount on one occurrence. */
const ZERO_OCCURRENCE = 'Must be more than 0. To leave this one out, skip it instead.'

/**
 * Builds the `PUT .../occurrences/:date` body from the form, giving each
 * amount its leg's sign.
 *
 * Each amount is checked first with the API's rules (a positive amount,
 * money through plugin-sdk); problems come back keyed like
 * {@link OverrideDraft.amounts}, so they can be shown under each field.
 * Moving too far from the nominal date is the server's to judge; its answer
 * lands on `expectedDate` through {@link overrideFieldFor}.
 *
 * @param item - The item.
 * @param draft - The form.
 * @returns The body, or the problems by field.
 */
export function overridePayload(
  item: RecurringItem,
  draft: OverrideDraft,
): { payload: { expectedDate: string | null; legs: { accountId: string; amount: string }[] } } | { errors: FormErrors } {
  const checks: Record<string, string | undefined> = {}
  const legs: { accountId: string; amount: string }[] = []
  for (const leg of item.legs) {
    const key = amountKey(item, leg.accountId)
    const typed = draft.amounts[key]?.trim() ?? ''
    checks[key] ??= checkMoney(typed, 'positive', ZERO_OCCURRENCE)
    legs.push({ accountId: leg.accountId, amount: leg.amount.startsWith('-') ? `-${typed}` : typed })
  }
  const errors = fieldErrors(checks)
  if (hasFormErrors(errors)) return { errors }
  const expectedDate = draft.expectedDate === draft.nominalDate || draft.expectedDate === '' ? null : draft.expectedDate
  return { payload: { expectedDate, legs } }
}

/**
 * Maps a path in the API's answer to the override form's field.
 *
 * @param item - The item; its legs are sent in order, so `legs.1` is its second leg.
 * @returns A matcher for `formErrorsFrom`.
 */
export function overrideFieldFor(item: RecurringItem): (path: string) => string | undefined {
  return (path) => {
    if (path === 'expectedDate') return path
    const match = /^legs\.(\d+)\.amount$/.exec(path)
    const leg = match === null ? undefined : item.legs[Number(match[1])]
    return leg === undefined ? undefined : amountKey(item, leg.accountId)
  }
}

/** The amount field a leg is typed in: the shared one for a two-sided item, its own otherwise. */
function amountKey(item: RecurringItem, accountId: string): string {
  return twoSided(item) ? SHARED_AMOUNT : accountId
}
