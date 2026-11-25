import { addMonths } from '@wickermoney/plugin-sdk/date'
import { unitsToMoney } from '@wickermoney/plugin-sdk/money'
import type { LumpSumInput } from './LumpSumInput.js'
import type { LumpSumOutcome } from './LumpSumOutcome.js'
import { MAX_PLAN_MONTHS } from './MAX_PLAN_MONTHS.js'
import { amount } from './parseDebts.js'

/** A lump sum the simulation pays in a given month, in units. */
export interface ResolvedLumpSum {
  readonly id: string
  readonly total: bigint
  /** Parts aimed at particular debts, in the order given. */
  readonly allocations: readonly { readonly debtId: string; readonly units: bigint }[]
}

/** Lump sums sorted into the plan month they are paid in, plus what to report about each. */
export interface ParsedLumpSums {
  /** The sums to pay, by plan month (1 is the first), each month's in the order given. */
  readonly byMonth: ReadonlyMap<number, readonly ResolvedLumpSum[]>
  /** One entry per lump sum, in the order given: what is known before the simulation runs. */
  readonly entries: readonly {
    readonly input: LumpSumInput
    readonly total: bigint
    /** The month it is paid in, or the reason it is ignored. */
    readonly where: number | 'past' | 'beyond_limit'
  }[]
}

/**
 * Validates lump sums and decides which plan month each is paid in.
 *
 * A lump sum is paid on the first payment date on or after its date, so one
 * dated on the day the balances are as of lands in month 1. One dated before
 * that day is `past`, and one after the plan's last month `beyond_limit`; the
 * plan ignores both and says so (see {@link LumpSumOutcome}).
 *
 * @param lumpSums - The lump sums, in the order they should be applied within a month.
 * @param startDate - The day the balances are as of, `YYYY-MM-DD`.
 * @returns Where each goes.
 * @throws {RangeError} For an empty or duplicate id, a date that is not on the
 *   calendar, an amount that is not a plain positive decimal with at most four
 *   places (or is larger than `numeric(19,4)` holds), an allocation with no
 *   debt, a repeated debt, or a non-positive amount, or allocations that add up
 *   to more than the lump sum.
 */
export function parseLumpSums(lumpSums: readonly LumpSumInput[], startDate: string): ParsedLumpSums {
  const seen = new Set<string>()
  const dates: string[] = []
  const paymentDate = (month: number): string => (dates[month] ??= addMonths(startDate, month))
  const byMonth = new Map<number, ResolvedLumpSum[]>()
  const entries = lumpSums.map((input) => {
    if (typeof input.id !== 'string' || input.id === '') throw new RangeError('A lump sum needs an id.')
    if (seen.has(input.id)) throw new RangeError(`Duplicate lump sum id: ${input.id}`)
    seen.add(input.id)
    addMonths(input.onDate, 0) // refuses a date that is not on the calendar
    const total = positive(input.amount, 'lump sum amount')
    const allocations = (input.allocations ?? []).map((part) => {
      if (typeof part.debtId !== 'string' || part.debtId === '') throw new RangeError('A lump sum part needs a debt.')
      return { debtId: part.debtId, units: positive(part.amount, 'lump sum part amount') }
    })
    if (new Set(allocations.map((part) => part.debtId)).size !== allocations.length) {
      throw new RangeError('A lump sum can name each debt only once.')
    }
    if (allocations.reduce((sum, part) => sum + part.units, 0n) > total) {
      throw new RangeError('The parts of a lump sum cannot add up to more than the lump sum.')
    }
    if (input.onDate < startDate) return { input, total, where: 'past' as const }
    let month = 1
    while (month <= MAX_PLAN_MONTHS && paymentDate(month) < input.onDate) month += 1
    if (month > MAX_PLAN_MONTHS) return { input, total, where: 'beyond_limit' as const }
    byMonth.set(month, [...(byMonth.get(month) ?? []), { id: input.id, total, allocations }])
    return { input, total, where: month }
  })
  return { byMonth, entries }
}

/**
 * Reports what happened to each lump sum once the plan has run.
 *
 * @param parsed - The result of {@link parseLumpSums}.
 * @param paid - What the simulation paid of each lump sum, by id, in units.
 * @param dateOf - The payment date of a plan month.
 * @returns One outcome per lump sum, in the order given.
 */
export function lumpSumOutcomes(
  parsed: ParsedLumpSums,
  paid: ReadonlyMap<string, bigint>,
  dateOf: (month: number) => string,
): LumpSumOutcome[] {
  return parsed.entries.map(({ input, total, where }): LumpSumOutcome => {
    if (typeof where === 'string') {
      return {
        id: input.id, onDate: input.onDate, amount: unitsToMoney(total), status: where,
        month: null, date: null, paid: unitsToMoney(0n), unused: unitsToMoney(total),
      }
    }
    const used = paid.get(input.id) ?? 0n
    return {
      id: input.id, onDate: input.onDate, amount: unitsToMoney(total), status: 'applied',
      month: where, date: dateOf(where), paid: unitsToMoney(used), unused: unitsToMoney(total - used),
    }
  })
}

/** An amount that must be greater than zero. */
function positive(value: string, label: string): bigint {
  const units = amount(value, label)
  if (units === 0n) throw new RangeError(`The ${label} must be more than zero.`)
  return units
}
