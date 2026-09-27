import type { AccountService } from '../../accounts/service/AccountService.js'
import type { AccountType } from '../models/index.js'
import type { Persona } from './seedPersonas.js'

/** One account to create for a persona. */
export interface AccountDef {
  /** Key used elsewhere in the seed to look this account back up (e.g. 'checking'). Not stored. */
  readonly key: string
  readonly name: string
  readonly accountType: AccountType
  /** Opening balance, signed the same way every derived balance is: negative means the account already owes or is overdrawn. */
  readonly initialBalance: string
  readonly bufferAmount: string
  /** Archived right after creation, to exercise an account a user has retired but kept for history. */
  readonly archived?: boolean
}

/**
 * The accounts each persona gets.
 *
 * `hero` covers every {@link AccountType} plus one archived account. The
 * checking account's buffer is set high relative to its typical spend on
 * purpose: combined with the recurring bills in {@link recurringItemDefsFor},
 * it is meant to trip the upcoming-bills widget's shortfall warning without
 * needing this file to hand-compute the derived balance itself.
 *
 * `second` gets just enough to look real (a checking and a savings account)
 * so the isolation check has something to look for.
 *
 * `fresh` gets nothing — no account exists until the wizard, or the user,
 * creates one.
 */
export function accountDefsFor(persona: Persona): readonly AccountDef[] {
  switch (persona.key) {
    case 'hero':
      return [
        { key: 'checking', name: 'Everyday Checking', accountType: 'checking', initialBalance: '3200.0000', bufferAmount: '1200.0000' },
        { key: 'savings', name: 'Rainy Day Savings', accountType: 'savings', initialBalance: '15500.0000', bufferAmount: '0.0000' },
        { key: 'credit_card', name: 'Rewards Credit Card', accountType: 'credit_card', initialBalance: '-450.0000', bufferAmount: '0.0000' },
        { key: 'loan', name: 'Auto Loan', accountType: 'loan', initialBalance: '-18500.0000', bufferAmount: '0.0000' },
        { key: 'investment', name: 'Brokerage', accountType: 'investment', initialBalance: '22000.0000', bufferAmount: '0.0000' },
        { key: 'archived_checking', name: 'Old Checking (closed)', accountType: 'checking', initialBalance: '0.0000', bufferAmount: '0.0000', archived: true },
      ]
    case 'second':
      return [
        { key: 'checking', name: 'Joint Checking', accountType: 'checking', initialBalance: '2200.0000', bufferAmount: '500.0000' },
        { key: 'savings', name: 'Savings', accountType: 'savings', initialBalance: '4300.0000', bufferAmount: '0.0000' },
      ]
    case 'fresh':
      return []
  }
}

/**
 * Creates every account in `defs`, archiving those marked so, and returns a
 * lookup from each def's {@link AccountDef.key} to the created account's id.
 *
 * @param service - Reused as-is: this is the same validation and insert path
 *   `POST /accounts` runs, so a seeded account is exactly as valid as one a
 *   real user created by hand.
 * @param userId - The persona's user id.
 * @param defs - From {@link accountDefsFor}.
 * @returns Map of def key to created account id.
 */
export async function createAccounts(
  service: AccountService,
  userId: string,
  defs: readonly AccountDef[],
): Promise<ReadonlyMap<string, string>> {
  const ids = new Map<string, string>()
  for (const def of defs) {
    const created = await service.create(userId, {
      name: def.name,
      accountType: def.accountType,
      initialBalance: def.initialBalance,
      currencyCode: 'USD',
      bufferAmount: def.bufferAmount,
    })
    ids.set(def.key, created.id)
    if (def.archived === true) await service.archive(userId, created.id)
  }
  return ids
}
