import { addMonths } from '@wickermoney/plugin-sdk/date'
import { moneyToUnits } from '@wickermoney/plugin-sdk/money'
import { COMPOUNDING_OPTIONS } from './Compounding.js'
import type { DebtInput } from './DebtInput.js'
import { MAX_APR_UNITS } from './MAX_APR_UNITS.js'
import { MAX_MONEY_UNITS } from './MAX_MONEY_UNITS.js'
import { MAX_PLAN_MONTHS } from './MAX_PLAN_MONTHS.js'
import type { ParsedDebt, ParsedPromo } from './ParsedDebt.js'
import { PROMO_INTEREST_BASES } from './PromoInterestBase.js'

/**
 * Validates debts and converts their amounts to exact integers.
 *
 * Strict by design, like the SDK's money module: nothing is rounded or
 * clamped, because a plan built on a quietly adjusted input answers a
 * different question from the one asked.
 *
 * @param debts - The debts, in the order the person keeps them.
 * @param startDate - The day the balances are as of, `YYYY-MM-DD`. Needed only when a debt has a repayment start or a promotion, to turn those dates into plan months.
 * @returns The same debts with amounts as `bigint` units, in the same order.
 * @throws {RangeError} For a duplicate or empty id, an amount that is not a
 *   plain decimal with at most four places, a negative amount, an amount larger
 *   than `numeric(19,4)` holds, or an APR above 999.9999.
 */
export function parseDebts(debts: readonly DebtInput[], startDate?: string): ParsedDebt[] {
  const seen = new Set<string>()
  return debts.map((debt, position) => {
    if (typeof debt.id !== 'string' || debt.id === '') throw new RangeError('A debt needs an id.')
    if (seen.has(debt.id)) throw new RangeError(`Duplicate debt id: ${debt.id}`)
    seen.add(debt.id)
    const repaymentStartsOn = debt.repaymentStartsOn ?? null
    return {
      id: debt.id,
      name: debt.name,
      balance: amount(debt.balance, 'balance'),
      apr: rate(debt.apr),
      minimum: amount(debt.minimumPayment, 'minimum payment'),
      extra: amount(debt.extraPayment ?? '0', 'extra payment for this debt'),
      position,
      startMonth: repaymentStartsOn === null ? 1 : firstMonthOnOrAfter(need(startDate, 'repayment start'), repaymentStartsOn),
      repaymentStartsOn,
      promo: parsePromo(debt, startDate),
      compounding: compoundingOf(debt),
    }
  })
}

/** Validates the compounding option; left out means monthly. */
function compoundingOf(debt: DebtInput) {
  const value = debt.compounding ?? 'monthly'
  if (!COMPOUNDING_OPTIONS.includes(value)) throw new RangeError(`Unknown compounding: ${String(value)}`)
  return value
}

/** Validates a debt's promotion fields, which come together or not at all. */
function parsePromo(debt: DebtInput, startDate: string | undefined): ParsedPromo | null {
  const apr = debt.promoApr ?? null
  const endsOn = debt.promoEndsOn ?? null
  const deferredInterest = debt.promoDeferredInterest ?? false
  const base = debt.promoInterestBase ?? 'original'
  if (!PROMO_INTEREST_BASES.includes(base)) throw new RangeError(`Unknown interest base: ${String(base)}`)
  if ((apr === null) !== (endsOn === null)) {
    throw new RangeError('A promotion needs both a rate and an end date.')
  }
  if (apr === null || endsOn === null) {
    if (deferredInterest) throw new RangeError('Deferred interest needs a promotion.')
    return null
  }
  return {
    apr: rate(apr, 'promotional APR'),
    endsOn,
    months: monthsOnOrBefore(need(startDate, 'promotion'), endsOn),
    deferredInterest,
    base,
  }
}

/** A start date is required for any date-based field. */
function need(startDate: string | undefined, what: string): string {
  if (startDate === undefined) throw new RangeError(`The ${what} date needs the plan's start date.`)
  return startDate
}

/** The first plan month (from 1) whose payment date is on or after `date`; one past the plan's limit if none is. */
function firstMonthOnOrAfter(startDate: string, date: string): number {
  addMonths(date, 0) // refuses a date that is not on the calendar
  for (let month = 1; month <= MAX_PLAN_MONTHS; month += 1) {
    if (addMonths(startDate, month) >= date) return month
  }
  return MAX_PLAN_MONTHS + 1
}

/** How many plan months have a payment date on or before `date`. */
function monthsOnOrBefore(startDate: string, date: string): number {
  addMonths(date, 0)
  let months = 0
  while (months < MAX_PLAN_MONTHS && addMonths(startDate, months + 1) <= date) months += 1
  return months
}

/** Parses a money amount that must be between zero and what the column holds. */
export function amount(value: string, label: string): bigint {
  const units = moneyToUnits(value, label)
  if (units < 0n) throw new RangeError(`The ${label} cannot be negative.`)
  if (units > MAX_MONEY_UNITS) throw new RangeError(`The ${label} is larger than can be stored.`)
  return units
}

/** Parses an APR percentage; the money parser is exact for any decimal with at most four places. */
function rate(value: string, label = 'APR'): bigint {
  const units = moneyToUnits(value, label)
  if (units < 0n) throw new RangeError(`The ${label} cannot be negative.`)
  if (units > MAX_APR_UNITS) throw new RangeError(`The ${label} cannot be more than 999.9999%.`)
  return units
}
