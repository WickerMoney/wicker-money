import { addDays, addMonths } from '@wickermoney/plugin-sdk/date'
import { asUser, type Db } from '../client.js'
import type { RecurrenceFrequency, RecurringKind } from '../models/index.js'
import type { Persona } from './seedPersonas.js'
import { firstDayOfMonth, todayIso } from './seedRng.js'

/** One leg of a seeded recurring item: a signed amount on one of the persona's accounts. */
export interface RecurringLegDef {
  /** Key of the account in `accountDefsFor` (e.g. `'checking'`). */
  readonly accountKey: string
  /** Signed decimal string: negative leaves the account, positive arrives. */
  readonly amount: string
}

/** One recurring item to insert: `core.recurring_items` plus its `core.recurring_item_legs`. */
export interface RecurringItemDef {
  readonly name: string
  readonly kind: RecurringKind
  readonly frequency: RecurrenceFrequency
  /** `YYYY-MM-DD`. */
  readonly seriesStartDate: string
  /** `YYYY-MM-DD`, or `undefined` for a series with no planned end. */
  readonly endDate?: string
  /** The two days of a `semimonthly` item; defaults to the 1st and 15th. */
  readonly semimonthlyDays?: readonly [number, number]
  readonly categorySlug?: string
  /** Where the money lands; the shape must match {@link kind} (the legs trigger checks it at commit). */
  readonly legs: readonly RecurringLegDef[]
}

/** Shorthand for a leg. */
function leg(accountKey: string, amount: string): RecurringLegDef {
  return { accountKey, amount }
}

/** Two legs moving `amount` (a positive decimal string) from one account to another. */
function move(fromKey: string, toKey: string, amount: string): readonly RecurringLegDef[] {
  return [leg(fromKey, `-${amount}`), leg(toKey, amount)]
}

/**
 * The recurring items each persona gets. Nothing reads them but a direct
 * database query until the recurring-items page and upcoming widget land;
 * seeding them now means both start in front of a full, correctly-shaped
 * dataset instead of an empty table.
 *
 * `hero` covers every {@link RecurrenceFrequency} value and every
 * {@link RecurringKind}: an ended series, a debt payment to each of the loan
 * and card accounts, a bill charged to the card, a monthly item anchored on
 * the 31st (the clamp case), a semimonthly item on the 15th and last day, and
 * a one-off.
 *
 * `household` is modelled on a real two-income household that runs its money
 * through two checking accounts: **Monthly Expenses** (rent, utilities, the
 * card) and **Yearly Expenses** (annual and quarterly bills). One paycheck is
 * split across both; a second income is paid biweekly on the offset week, so
 * there is a payday every week; and savings transfers feed a sinking fund.
 * It exists to exercise the upcoming widget's rules — per-account shortfall,
 * transfers that are not spending, Yearly never "covering" Monthly.
 */
export function recurringItemDefsFor(personaKey: Persona['key']): readonly RecurringItemDef[] {
  const today = todayIso()
  if (personaKey === 'hero') {
    return [
      { name: 'Employer Payroll', kind: 'income', frequency: 'biweekly', seriesStartDate: addDays(today, -370), categorySlug: 'salary', legs: [leg('checking', '2850.0000')] },
      { name: 'Rent', kind: 'bill', frequency: 'monthly', seriesStartDate: addDays(today, -400), categorySlug: 'mortgage-rent', legs: [leg('checking', '-1550.0000')] },
      { name: 'Auto Loan Payment', kind: 'debt_payment', frequency: 'monthly', seriesStartDate: addDays(today, -400), legs: move('checking', 'loan', '425.0000') },
      { name: 'Credit Card Payment', kind: 'debt_payment', frequency: 'monthly', seriesStartDate: addDays(today, -400), legs: move('checking', 'credit_card', '400.0000') },
      { name: 'Electricity', kind: 'bill', frequency: 'monthly', seriesStartDate: addDays(today, -400), categorySlug: 'electricity', legs: [leg('checking', '-95.0000')] },
      { name: 'Car Insurance', kind: 'bill', frequency: 'quarterly', seriesStartDate: addDays(today, -400), categorySlug: 'car-insurance', legs: [leg('checking', '-410.0000')] },
      { name: 'Amazon Prime', kind: 'bill', frequency: 'annual', seriesStartDate: addDays(today, -400), categorySlug: 'subscriptions', legs: [leg('checking', '-139.0000')] },
      // A bill charged to the card rather than paid from checking.
      { name: 'Streaming Bundle', kind: 'bill', frequency: 'monthly', seriesStartDate: addDays(today, -200), categorySlug: 'streaming-video', legs: [leg('credit_card', '-22.9900')] },
      // Daily and weekly items exist purely to give every RecurrenceFrequency
      // value at least one row; neither is meant to look like typical spend.
      { name: 'Parking Meter', kind: 'bill', frequency: 'daily', seriesStartDate: addDays(today, -60), legs: [leg('checking', '-3.5000')] },
      { name: 'Housecleaner', kind: 'bill', frequency: 'weekly', seriesStartDate: addDays(today, -200), legs: [leg('checking', '-120.0000')] },
      // Anchored on the 31st: the clamp case. Jan 31 always exists, so this
      // literal is valid regardless of when the seed runs.
      { name: 'Storage Unit', kind: 'bill', frequency: 'monthly', seriesStartDate: nearestPastJan31(today), legs: [leg('checking', '-58.0000')] },
      // Ended two months ago: a cancelled subscription, kept for history.
      { name: 'Old Gym Membership', kind: 'bill', frequency: 'monthly', seriesStartDate: addDays(today, -400), endDate: addDays(today, -60), legs: [leg('checking', '-45.0000')] },
      // A large, closely-spaced bill: meant to make the upcoming widget's
      // shortfall warning fire against checking's buffer_amount.
      { name: 'Homeowners/Renters Insurance Installment', kind: 'bill', frequency: 'quarterly', seriesStartDate: addDays(today, -75), legs: [leg('checking', '-900.0000')] },
      // The 15th and the last day of the month.
      { name: 'Freelance Retainer', kind: 'income', frequency: 'semimonthly', semimonthlyDays: [15, 31], seriesStartDate: addDays(today, -300), categorySlug: 'salary', legs: [leg('checking', '450.0000')] },
      // A one-off future item: what the old app called "Add future expense".
      { name: 'Annual Checkup Copay', kind: 'bill', frequency: 'once', seriesStartDate: addDays(today, 10), legs: [leg('checking', '-40.0000')] },
    ]
  }
  if (personaKey === 'second') {
    return [
      { name: 'Employer Payroll', kind: 'income', frequency: 'biweekly', seriesStartDate: addDays(today, -370), categorySlug: 'salary', legs: [leg('checking', '2100.0000')] },
      { name: 'Rent', kind: 'bill', frequency: 'monthly', seriesStartDate: addDays(today, -370), categorySlug: 'mortgage-rent', legs: [leg('checking', '-1200.0000')] },
    ]
  }
  if (personaKey === 'household') {
    const monthStart = firstDayOfMonth(today)
    return [
      // Split paycheck: most into Monthly Expenses, a slice straight into Yearly.
      { name: 'Alex Paycheck', kind: 'income', frequency: 'biweekly', seriesStartDate: addDays(today, -365), categorySlug: 'salary', legs: [leg('monthly', '1850.0000'), leg('yearly', '350.0000')] },
      // Second income, biweekly on the offset week: a payday every week.
      { name: 'Sam Paycheck', kind: 'income', frequency: 'biweekly', seriesStartDate: addDays(today, -358), categorySlug: 'salary', legs: [leg('monthly', '1420.0000')] },
      { name: 'Mortgage', kind: 'bill', frequency: 'monthly', seriesStartDate: addMonths(monthStart, -12), categorySlug: 'mortgage-rent', legs: [leg('monthly', '-2100.0000')] },
      { name: 'Electricity', kind: 'bill', frequency: 'monthly', seriesStartDate: addDays(today, -340), categorySlug: 'electricity', legs: [leg('monthly', '-140.0000')] },
      { name: 'Phones', kind: 'bill', frequency: 'monthly', seriesStartDate: addDays(today, -330), categorySlug: 'mobile-phone', legs: [leg('monthly', '-85.0000')] },
      { name: 'Card Payment', kind: 'debt_payment', frequency: 'monthly', seriesStartDate: addDays(today, -320), legs: move('monthly', 'credit_card', '600.0000') },
      { name: 'Streaming', kind: 'bill', frequency: 'monthly', seriesStartDate: addDays(today, -300), categorySlug: 'streaming-video', legs: [leg('credit_card', '-15.4900')] },
      // Yearly Expenses pays the big, infrequent bills.
      { name: 'Car Insurance', kind: 'bill', frequency: 'annual', seriesStartDate: addDays(today, -350), categorySlug: 'car-insurance', legs: [leg('yearly', '-1260.0000')] },
      { name: 'Property Tax', kind: 'bill', frequency: 'quarterly', seriesStartDate: addDays(today, -80), categorySlug: 'property-taxes', legs: [leg('yearly', '-1150.0000')] },
      { name: 'Amazon Prime', kind: 'bill', frequency: 'annual', seriesStartDate: addDays(today, -300), categorySlug: 'subscriptions', legs: [leg('yearly', '-139.0000')] },
      // Sinking funds: own-account transfers, never spending.
      { name: 'Vacation Fund', kind: 'transfer', frequency: 'monthly', seriesStartDate: addDays(today, -250), legs: move('monthly', 'savings', '200.0000') },
      { name: 'Holiday Fund', kind: 'transfer', frequency: 'semimonthly', semimonthlyDays: [1, 15], seriesStartDate: addDays(today, -200), legs: move('yearly', 'savings', '50.0000') },
      // A one-off coming up inside the next pay cycle.
      { name: 'Dental Crown', kind: 'bill', frequency: 'once', seriesStartDate: addDays(today, 9), categorySlug: 'dental-visits', legs: [leg('monthly', '-650.0000')] },
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
 * Inserts every recurring-item def and its legs, bound to the persona's tenant
 * context so row-level security applies exactly as it would to any other
 * write.
 *
 * A direct insert, not a service, because none exists yet. Each item and its
 * legs go in one transaction: the legs trigger is deferred to commit, so the
 * item can be written before the legs that make it valid.
 *
 * @param db - Application database handle.
 * @param userId - The persona's user id.
 * @param defs - From {@link recurringItemDefsFor}.
 * @param accountIds - From `createAccounts`.
 * @param slugToId - This persona's catalog slug to category id map.
 * @throws {Error} If a leg names an account key the persona does not have.
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
      const days = def.frequency === 'semimonthly' ? (def.semimonthlyDays ?? [1, 15]) : null
      const item = await trx
        .insertInto('core.recurring_items')
        .values({
          user_id: userId,
          name: def.name,
          kind: def.kind,
          frequency: def.frequency,
          series_start_date: def.seriesStartDate,
          end_date: def.endDate ?? null,
          semimonthly_day_1: days === null ? null : Math.min(days[0], days[1]),
          semimonthly_day_2: days === null ? null : Math.max(days[0], days[1]),
          category_id: def.categorySlug === undefined ? null : (slugToId.get(def.categorySlug) ?? null),
        })
        .returning('id')
        .executeTakeFirstOrThrow()
      await trx
        .insertInto('core.recurring_item_legs')
        .values(def.legs.map((l) => {
          const accountId = accountIds.get(l.accountKey)
          if (accountId === undefined) throw new Error(`Seed item '${def.name}' names unknown account '${l.accountKey}'`)
          return { user_id: userId, recurring_item_id: item.id, account_id: accountId, amount: l.amount }
        }))
        .execute()
    }
  })
}
