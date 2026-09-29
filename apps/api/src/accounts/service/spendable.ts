import type { AccountType } from '../../db/models/index.js'
import { ValidationError } from '../../errors.js'
import type { AccountChanges } from '../repository/AccountChanges.js'

/**
 * Account types whose balance can count toward safe to spend. A card's or
 * loan's balance is debt, and an investment account is not money for this
 * week. Migration 022's CHECK holds the same list.
 */
const SPENDABLE_TYPES: ReadonlySet<string> = new Set<AccountType>(['checking', 'savings'])

/**
 * Whether an account of this type may be marked spendable.
 *
 * @param type - The account type.
 * @returns True for checking and savings.
 */
export function canBeSpendable(type: string): boolean {
  return SPENDABLE_TYPES.has(type)
}

/**
 * The `spendable` value for a new account: the caller's choice, or the
 * default for its type (checking yes, everything else no).
 *
 * @param type - The new account's type.
 * @param requested - The caller's choice, if any.
 * @returns The value to store.
 * @throws {ValidationError} If `requested` is true for a type that cannot be spendable.
 */
export function spendableForNew(type: AccountType, requested: boolean | undefined): boolean {
  if (requested === true && !canBeSpendable(type)) throw notSpendable(type)
  return requested ?? type === 'checking'
}

/**
 * Applies the spendable rule to an edit.
 *
 * Changing a spendable savings account into a card clears the flag rather
 * than refusing the edit: the user asked to change the type, and a card never
 * counts, so the flag has only one sensible value. Asking for a card to be
 * spendable in the same edit is refused, since that is a contradiction rather
 * than a side effect.
 *
 * @param current - The account as stored.
 * @param changes - The requested edit.
 * @returns The edit to apply.
 * @throws {ValidationError} If the edit would make a card, loan or investment account spendable.
 */
export function spendableChanges(
  current: { readonly account_type: string; readonly spendable: boolean },
  changes: AccountChanges,
): AccountChanges {
  const type = changes.accountType ?? current.account_type
  if (canBeSpendable(type)) return changes
  if (changes.spendable === true) throw notSpendable(type)
  return current.spendable ? { ...changes, spendable: false } : changes
}

/** The refusal for a type that cannot count toward safe to spend. */
function notSpendable(type: string): ValidationError {
  return new ValidationError(
    `spendable: only checking and savings accounts can count toward safe to spend, not ${type.replace('_', ' ')}.`,
  )
}
