import { addDays } from '@wickermoney/plugin-sdk/recurrence'
import type { Services } from '../../composition/Services.js'

/** Name of the weekly item that carries the late, skipped and dismissed occurrences. */
export const LAWN_SERVICE = 'Lawn Service'

/** What {@link seedRecurringMatches} set up, for its test and the CLI. */
export interface SeededMatches {
  /** The user's today, as the API works it out; every date below is relative to it. */
  readonly today: string
  /** Occurrences matched to transactions, so they show as paid or arrived. */
  readonly cleared: readonly { readonly item: string; readonly nominalDate: string }[]
  /** The Lawn Service occurrence the user is away for. */
  readonly skipped: string
  /** The Lawn Service occurrence that has not shown up: tracked, three days past. */
  readonly late: string
  /** The transaction waiting to be confirmed as Sam's last paycheck. */
  readonly suggestedTransactionId: string
  /** The transaction the user said is not the late Lawn Service payment. */
  readonly dismissedTransactionId: string
}

/**
 * Gives the `household` persona a matching history, so a fresh demo instance
 * shows every state paid / landed matching can produce:
 *
 * - **cleared**: Alex's last two split paychecks, each matched on both
 *   accounts, and two earlier Lawn Service payments;
 * - **late**: the Lawn Service three days ago, on an item that is tracked (it
 *   has been matched before) with no payment yet;
 * - **skipped**: next week's Lawn Service ("away that week");
 * - **a pending suggestion**: Sam's paycheck that landed a day after its
 *   date, not confirmed yet, so "Did these land?" and the Transactions page
 *   both offer it;
 * - **a dismissed suggestion**: a garden-centre purchase close enough to the
 *   late Lawn Service to be suggested for it, which the user said it is not.
 *
 * Household has no other ledger history, so nothing else competes for these
 * suggestions. Everything goes through the same services the API uses, and
 * dates are relative to the user's today, so the demo means the same thing
 * whenever it is seeded. Lawn Service is created here rather than in
 * `recurringItemDefsFor` because its schedule has to be anchored on today.
 *
 * @param services - The application services.
 * @param userId - The household persona's user id.
 * @param accountIds - From `createAccounts`; needs `monthly` and `yearly`.
 * @param slugToId - This persona's catalog slug to category id map.
 * @returns What was set up.
 * @throws {Error} If the persona is missing an account or item this relies on.
 */
export async function seedRecurringMatches(
  services: Services,
  userId: string,
  accountIds: ReadonlyMap<string, string>,
  slugToId: ReadonlyMap<string, string>,
): Promise<SeededMatches> {
  const monthly = required(accountIds.get('monthly'), "account 'monthly'")
  const yearly = required(accountIds.get('yearly'), "account 'yearly'")
  const { today, items } = await services.recurringItems.list(userId)
  const itemId = (name: string) => required(items.find((i) => i.name === name)?.id, `item '${name}'`)

  const spend = async (accountId: string, amount: string, merchant: string, transactionDate: string, categorySlug?: string) =>
    (await services.transactions.create(userId, {
      accountId, amount, merchant, transactionDate,
      categoryId: categorySlug === undefined ? null : (slugToId.get(categorySlug) ?? null),
    })).id
  /** Nominal dates of an item's occurrences in `[from, to)`, oldest first. */
  const datesOf = async (id: string, from: string, to: string) =>
    (await services.recurringItems.occurrences(userId, { itemId: id, from, to })).occurrences.map((o) => o.nominalDate)
  const cleared: { item: string; nominalDate: string }[] = []

  // ---- cleared: Alex's last two paychecks, both legs each -----------------
  const alex = itemId('Alex Paycheck')
  for (const date of (await datesOf(alex, addDays(today, -28), addDays(today, 1))).slice(-2)) {
    const toMonthly = await spend(monthly, '1850.0000', 'ACME CORP PAYROLL', date, 'salary')
    const toYearly = await spend(yearly, '350.0000', 'ACME CORP PAYROLL', date, 'salary')
    await services.recurringOccurrences.match(userId, alex, date, toMonthly)
    await services.recurringOccurrences.match(userId, alex, date, toYearly)
    cleared.push({ item: 'Alex Paycheck', nominalDate: date })
  }

  // ---- Lawn Service: weekly, on today - 3 ---------------------------------
  const lawn = (await services.recurringItems.create(userId, {
    name: LAWN_SERVICE, kind: 'bill', frequency: 'weekly', seriesStartDate: addDays(today, -24),
    categoryId: slugToId.get('lawn-care') ?? null, legs: [{ accountId: monthly, amount: '-45.0000' }],
  })).id
  // Paid on the day and a day late: these make the item tracked.
  for (const [date, paid] of [[addDays(today, -17), addDays(today, -17)], [addDays(today, -10), addDays(today, -9)]] as const) {
    const tx = await spend(monthly, '-45.0000', 'GREENCUT LAWN CARE', paid, 'lawn-care')
    await services.recurringOccurrences.match(userId, lawn, date, tx)
    cleared.push({ item: LAWN_SERVICE, nominalDate: date })
  }
  const late = addDays(today, -3)
  const skipped = addDays(today, 4)
  await services.recurringOccurrences.override(userId, lawn, skipped, { skipped: true, expectedDate: null, legs: null })

  // ---- dismissed: close to the late Lawn Service, but not it --------------
  const garden = await spend(monthly, '-42.1800', 'GARDEN CENTRE', addDays(today, -2), 'household-items')
  await services.recurringOccurrences.dismiss(userId, lawn, late, garden)

  // ---- pending suggestion: Sam's latest paycheck, a day late --------------
  const sam = itemId('Sam Paycheck')
  const samDate = required((await datesOf(sam, addDays(today, -13), addDays(today, 1))).at(-1), 'a recent Sam Paycheck')
  const landed = samDate < today ? addDays(samDate, 1) : samDate
  const suggested = await spend(monthly, '1420.0000', 'BRIGHTSIDE CLINIC PAYROLL', landed, 'salary')

  return { today, cleared, skipped, late, suggestedTransactionId: suggested, dismissedTransactionId: garden }
}

/** @throws {Error} Naming what is missing. */
function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`Seed matching needs ${what}`)
  return value
}
