import { asUser, type Db } from '../client.js'
import type { RecurrenceFrequency } from '../models/index.js'
import { addDays, todayIso } from './seedRng.js'

/** One row to insert into `core.recurring_items`. */
export interface RecurringItemDef {
  readonly accountKey: string
  readonly name: string
  readonly amount: string
  readonly frequency: RecurrenceFrequency
  /** `YYYY-MM-DD`. */
  readonly seriesStartDate: string
  /** `YYYY-MM-DD`, or `undefined` for a series with no planned end. */
  readonly endDate?: string
  readonly categorySlug?: string
  readonly isIncome?: boolean
  /** Set for a transfer-type item (a loan or credit-card payment); mutually exclusive with `isIncome`. */
  readonly transferToAccountKey?: string
}

/**
 * `core.recurring_items` has no route, no service and no UI yet — per
 * `ROADMAP.md` this is squarely "Next", not shipped. Seeding it anyway costs
 * nothing and means the moment that page or the upcoming-bills widget lands,
 * there is already a full, correctly-shaped dataset in front of it instead of
 * an empty table. There is currently no way to see these rows except a direct
 * database query — that is expected, not a seed bug.
 *
 * `hero`'s set covers every {@link RecurrenceFrequency} value that exists
 * today (`semimonthly` is on the roadmap but not yet a database enum value, so
 * it is not here), an ended series, a transfer-type item for each of the
 * `loan` and `credit_card` accounts (the shape `ROADMAP.md` describes for
 * "payments to credit_card/loan accounts count as bills"), and one monthly
 * item anchored on the 31st — the clamp-to-last-day case called out in the
 * roadmap decisions doc, which only a series literally started on a 31st
 * exercises.
 */
export function recurringItemDefsFor(personaKey: 'hero' | 'second' | 'fresh'): readonly RecurringItemDef[] {
  const today = todayIso()
  if (personaKey === 'hero') {
    return [
      { accountKey: 'checking', name: 'Employer Payroll', amount: '2850.0000', frequency: 'biweekly', seriesStartDate: addDays(today, -370), categorySlug: 'salary', isIncome: true },
      { accountKey: 'checking', name: 'Rent', amount: '-1550.0000', frequency: 'monthly', seriesStartDate: addDays(today, -400), categorySlug: 'mortgage-rent' },
      { accountKey: 'checking', name: 'Auto Loan Payment', amount: '-425.0000', frequency: 'monthly', seriesStartDate: addDays(today, -400), transferToAccountKey: 'loan' },
      { accountKey: 'checking', name: 'Credit Card Payment', amount: '-400.0000', frequency: 'monthly', seriesStartDate: addDays(today, -400), transferToAccountKey: 'credit_card' },
      { accountKey: 'checking', name: 'Electricity', amount: '-95.0000', frequency: 'monthly', seriesStartDate: addDays(today, -400), categorySlug: 'electricity' },
      { accountKey: 'checking', name: 'Car Insurance', amount: '-410.0000', frequency: 'quarterly', seriesStartDate: addDays(today, -400), categorySlug: 'car-insurance' },
      { accountKey: 'checking', name: 'Amazon Prime', amount: '-139.0000', frequency: 'annual', seriesStartDate: addDays(today, -400), categorySlug: 'subscriptions' },
      // Daily and weekly items exist purely to give every RecurrenceFrequency
      // value at least one row; neither is meant to look like typical spend.
      { accountKey: 'checking', name: 'Parking Meter', amount: '-3.5000', frequency: 'daily', seriesStartDate: addDays(today, -60) },
      { accountKey: 'checking', name: 'Housecleaner', amount: '-120.0000', frequency: 'weekly', seriesStartDate: addDays(today, -200) },
      // Anchored on the 31st: the clamp case. Jan 31 always exists, so this
      // literal is valid regardless of when the seed runs.
      { accountKey: 'checking', name: 'Storage Unit', amount: '-58.0000', frequency: 'monthly', seriesStartDate: nearestPastJan31(today) },
      // Ended two months ago: a cancelled subscription, kept for history.
      { accountKey: 'checking', name: 'Old Gym Membership', amount: '-45.0000', frequency: 'monthly', seriesStartDate: addDays(today, -400), endDate: addDays(today, -60) },
      // A large, closely-spaced bill: intended to make the (not-yet-built)
      // upcoming-bills widget's shortfall warning fire against checking's
      // buffer_amount. Best-effort — nothing here computes the derived
      // balance to guarantee it, since nothing can read this table yet.
      { accountKey: 'checking', name: 'Homeowners/Renters Insurance Installment', amount: '-900.0000', frequency: 'quarterly', seriesStartDate: addDays(today, -75) },
    ]
  }
  if (personaKey === 'second') {
    return [
      { accountKey: 'checking', name: 'Employer Payroll', amount: '2100.0000', frequency: 'biweekly', seriesStartDate: addDays(today, -370), categorySlug: 'salary', isIncome: true },
      { accountKey: 'checking', name: 'Rent', amount: '-1200.0000', frequency: 'monthly', seriesStartDate: addDays(today, -370), categorySlug: 'mortgage-rent' },
    ]
  }
  return []
}

/** The most recent January 31st that is not in the future, as `YYYY-MM-DD`. */
function nearestPastJan31(todayIsoDate: string): string {
  const year = Number(todayIsoDate.slice(0, 4))
  const thisYear = `${year}-01-31`
  return thisYear <= todayIsoDate ? thisYear : `${year - 1}-01-31`
}

/**
 * Inserts every recurring-item def directly into `core.recurring_items`,
 * bound to the persona's tenant context so row-level security applies exactly
 * as it would to any other write.
 *
 * A direct insert, not a service, because none exists yet (see the module
 * doc). Written the same way `AccountRepository`/`TransactionRepository` are:
 * a straight `insertInto` under `asUser`, so the day a real
 * `RecurringItemService` lands, replacing this call is the only change needed
 * here.
 *
 * @param db - Application database handle.
 * @param userId - The persona's user id.
 * @param defs - From {@link recurringItemDefsFor}.
 * @param accountIds - From `createAccounts`.
 * @param slugToId - This persona's catalog slug to category id map.
 */
export async function createRecurringItems(
  db: Db,
  userId: string,
  defs: readonly RecurringItemDef[],
  accountIds: ReadonlyMap<string, string>,
  slugToId: ReadonlyMap<string, string>,
): Promise<void> {
  if (defs.length === 0) return
  await asUser(db, userId, async (trx) => {
    for (const def of defs) {
      await trx
        .insertInto('core.recurring_items')
        .values({
          user_id: userId,
          account_id: accountIds.get(def.accountKey)!,
          name: def.name,
          amount: def.amount,
          frequency: def.frequency,
          series_start_date: def.seriesStartDate,
          end_date: def.endDate ?? null,
          category_id: def.categorySlug === undefined ? null : (slugToId.get(def.categorySlug) ?? null),
          is_income: def.isIncome ?? false,
          transfer_account_id:
            def.transferToAccountKey === undefined ? null : (accountIds.get(def.transferToAccountKey) ?? null),
        })
        .execute()
    }
  })
}
