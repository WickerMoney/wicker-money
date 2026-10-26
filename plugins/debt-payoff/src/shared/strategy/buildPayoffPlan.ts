import { addMonths } from '@wickermoney/plugin-sdk/date'
import { unitsToMoney } from '@wickermoney/plugin-sdk/money'
import { daysBetween } from './daysBetween.js'
import { MAX_PLAN_MONTHS } from './MAX_PLAN_MONTHS.js'
import type { ParsedDebt } from './ParsedDebt.js'
import type { PlanPromo } from './PlanPromo.js'
import { monthlyInterest } from './monthlyInterest.js'
import type { DebtInput } from './DebtInput.js'
import type { PayoffPlan } from './PayoffPlan.js'
import type { PlanDebt } from './PlanDebt.js'
import type { PlanMonth } from './PlanMonth.js'
import type { PlanOptions } from './PlanOptions.js'
import type { PlanTotals } from './PlanTotals.js'
import { amount, parseDebts } from './parseDebts.js'
import { priorityOrder } from './priorityOrder.js'
import { simulate, type Simulation } from './simulate.js'
import { STRATEGIES } from './STRATEGIES.js'

/**
 * @module
 * The snowball and avalanche payoff plans.
 *
 * **Conventions** (also stated in the pull request and the developer guide):
 *
 * - **Compounding.** Nominal APR, compounded monthly. Each month's interest is
 *   `opening balance × APR ÷ 12`. Interest is added to the balance, so unpaid
 *   interest earns interest the next month. There is no daily accrual, no
 *   grace period and no fee.
 * - **Timing.** The balances are as of `startDate`. Interest accrues over each
 *   month and the payment is made at its end, so month 1's payment is dated
 *   `startDate` plus one month and is applied to a balance that already holds
 *   that month's interest. A debt's last payment is therefore its balance plus
 *   that month's interest, and its payoff date is that payment's date.
 * - **Rounding.** Interest is rounded to a whole unit of 0.0001, half away
 *   from zero, once per debt per month, by the SDK's `divideUnits`. Nothing
 *   else is rounded: payments are the person's own amounts or exact
 *   remainders, and every total is an exact sum of integers.
 * - **Money.** Everything is `bigint` units of 0.0001 internally and decimal
 *   strings at the edge. No `number` holds an amount.
 * - **The monthly amount.** While any debt remains, the same amount is paid
 *   every month: the sum of the minimums of the debts that had a balance at the
 *   start, plus the extra. When a debt is paid off its minimum stays in that
 *   amount and moves to the next debt in line (the "rolling" in snowball and
 *   avalanche). A debt that starts at zero contributes no minimum.
 * - **Earmarks.** A debt may carry its own extra amount, paid every month
 *   after its minimum and before the pooled money is aimed anywhere. It is
 *   outside the pool and never added to it, so when the debt is paid off the
 *   earmark stops: it does not move to another debt (the debt-free date moves
 *   later instead). Freed minimums still roll. An earmark is capped at what
 *   the debt still owes, and the minimums-only scenario ignores it.
 * - **Compounding.** A debt may instead compound daily, or accrue simple
 *   daily interest (`Compounding`); both use the real number of days in
 *   each month between payment dates. The default is the monthly rule above.
 * - **Deferment.** A debt with a repayment start date owes no minimum until the
 *   first plan month whose payment date is on or after it. Until then interest
 *   accrues into the balance, the pooled money skips it (only its earmark can
 *   pay it) and its minimum is not in the pool. A debt paid off before it
 *   starts never adds a minimum. The monthly amount therefore rises when a
 *   deferred debt starts; `monthlyBudget` is the first month's.
 * - **Promotions.** Until its end date a debt uses the promotional rate. With
 *   deferred interest, interest at the standard APR is tracked for every month
 *   of the promotion (on the starting balance or on the falling balance, as
 *   chosen) and added to the balance in the promotion's last month if anything
 *   is still owed. So the plan does not let that happen by choice, a debt with
 *   deferred interest is paid, before the strategy is applied, the even
 *   payment that clears it in time, out of the pool, earliest deadline first.
 *   If the pool cannot cover it the shortfall is reported and the interest is
 *   charged. A promotion that ended before the first payment is taken as over
 *   and the balance as already including any charge. The minimums-only
 *   scenario pays minimums only and so can trigger the charge.
 * - **Limit.** A schedule is at most {@link MAX_PLAN_MONTHS} months. Past that,
 *   or once a balance outgrows what the database can store, the plan stops,
 *   is flagged `capped` and has no debt-free date.
 *
 * Pure: no clock, no I/O, no floating point.
 */

/**
 * Builds the payoff plan for a set of debts.
 *
 * Also runs the same debts as "minimums only" (each debt paid only its own
 * minimum, nothing rolled over, no extra) so the plan can say what it saves.
 *
 * @param debts - The debts, in the order the person keeps them; that order
 *   breaks ties between debts the strategy treats as equal.
 * @param options - The strategy, the monthly extra, and the date the balances
 *   are as of.
 * @returns The plan. With no debts, or only debts at zero, the schedule is
 *   empty and the debt-free date is the start date.
 * @throws {RangeError} For an invalid debt (see {@link parseDebts}), an unknown
 *   strategy, an invalid or negative extra, or a start date that is not a real
 *   calendar date.
 * @example
 * buildPayoffPlan(
 *   [{ id: 'card', name: 'Card', balance: '1000', apr: '12', minimumPayment: '100' }],
 *   { strategy: 'avalanche', extraPayment: '0', startDate: '2026-01-31' },
 * ).debtFreeDate // '2026-11-30'
 */
export function buildPayoffPlan(debts: readonly DebtInput[], options: PlanOptions): PayoffPlan {
  if (!STRATEGIES.includes(options.strategy)) {
    throw new RangeError(`Unknown strategy: ${String(options.strategy)}`)
  }
  const extra = amount(options.extraPayment, 'extra payment')
  addMonths(options.startDate, 0) // validates the date up front, so an empty plan refuses a bad one too

  const parsed = parseDebts(debts, options.startDate)
  const owing = parsed.filter((debt) => debt.balance > 0n)
  const settled = parsed.filter((debt) => debt.balance === 0n)
  const ordered = priorityOrder(owing, options.strategy)

  const dateOf = (month: number): string => addMonths(options.startDate, month)
  const daysIn = (month: number): number => daysBetween(dateOf(month - 1), dateOf(month))

  const plan = simulate({ debts: ordered, extra, rollover: true, daysIn })
  const baseline = simulate({ debts: ordered, extra: 0n, rollover: false, daysIn })

  const planDebts: PlanDebt[] = [
    ...plan.runs.map((run): PlanDebt => ({
      id: run.debt.id,
      name: run.debt.name,
      startingBalance: unitsToMoney(run.debt.balance),
      apr: unitsToMoney(run.debt.apr),
      minimumPayment: unitsToMoney(run.debt.minimum),
      extraPayment: unitsToMoney(run.debt.extra),
      earmarkCoversBalance: run.debt.extra > 0n && run.debt.extra >= run.debt.balance,
      minimumCoversInterest: run.debt.minimum >= monthlyInterest(run.debt.balance, run.debt.apr),
      payoffMonth: run.payoffMonth,
      payoffDate: run.payoffMonth === null ? null : dateOf(run.payoffMonth),
      totalInterest: unitsToMoney(run.interest),
      totalPaid: unitsToMoney(run.paid),
      ...timelineOf(run.debt, run),
    })),
    ...settled.map((debt): PlanDebt => ({
      id: debt.id,
      name: debt.name,
      startingBalance: unitsToMoney(0n),
      apr: unitsToMoney(debt.apr),
      minimumPayment: unitsToMoney(debt.minimum),
      extraPayment: unitsToMoney(debt.extra),
      earmarkCoversBalance: false,
      minimumCoversInterest: true,
      payoffMonth: 0,
      payoffDate: options.startDate,
      totalInterest: unitsToMoney(0n),
      totalPaid: unitsToMoney(0n),
      ...timelineOf(debt, null),
    })),
  ]

  const schedule: PlanMonth[] = plan.months.map((row) => ({
    month: row.month,
    date: dateOf(row.month),
    interest: unitsToMoney(row.interest),
    payment: unitsToMoney(row.payment),
    balance: unitsToMoney(row.balance),
    debts: row.debts.map((line) => ({
      debtId: line.run.debt.id,
      interest: unitsToMoney(line.interest),
      payment: unitsToMoney(line.payment),
      balance: unitsToMoney(line.balance),
    })),
  }))

  const totals = totalsOf(plan, dateOf)
  const minimumsOnly = totalsOf(baseline, dateOf)
  const comparable = !totals.capped && !minimumsOnly.capped

  return {
    strategy: options.strategy,
    extraPayment: unitsToMoney(extra),
    startDate: options.startDate,
    monthlyBudget: unitsToMoney(owing.reduce((sum, debt) => (debt.startMonth <= 1 ? sum + debt.minimum : sum), 0n) + extra),
    earmarked: unitsToMoney(owing.reduce((sum, debt) => sum + debt.extra, 0n)),
    order: ordered.map((debt) => debt.id),
    debts: planDebts,
    startingBalance: unitsToMoney(owing.reduce((sum, debt) => sum + debt.balance, 0n)),
    totalInterest: totals.totalInterest,
    totalPaid: unitsToMoney(plan.runs.reduce((sum, run) => sum + run.paid, 0n)),
    months: totals.months,
    debtFreeDate: totals.debtFreeDate,
    capped: totals.capped,
    cappedReason: plan.capped,
    monthLimit: MAX_PLAN_MONTHS,
    schedule,
    minimumsOnly,
    monthsSaved: comparable ? minimumsOnly.months - totals.months : null,
    interestSaved: comparable
      ? unitsToMoney(
          baseline.runs.reduce((sum, run) => sum + run.interest, 0n) -
            plan.runs.reduce((sum, run) => sum + run.interest, 0n),
        )
      : null,
  }
}

/** The timeline, compounding and promotion figures of one debt, for its {@link PlanDebt}. */
function timelineOf(
  debt: ParsedDebt,
  run: { readonly payoffMonth: number | null; readonly backdated: bigint; readonly requiredFirst: bigint | null; readonly shortfall: bigint } | null,
): Pick<PlanDebt, 'repaymentStartsOn' | 'repaymentStartMonth' | 'compounding' | 'promo'> {
  const { promo } = debt
  const active = promo !== null && promo.months > 0
  const planPromo: PlanPromo | null = promo === null ? null : {
    apr: unitsToMoney(promo.apr),
    endsOn: promo.endsOn,
    deferredInterest: promo.deferredInterest,
    interestBase: promo.base,
    active,
    clearedInTime: !active || run === null ? null : run.payoffMonth !== null && run.payoffMonth <= promo.months,
    backdatedInterest: unitsToMoney(run?.backdated ?? 0n),
    requiredPayment: !active || !promo.deferredInterest || run?.requiredFirst == null ? null : unitsToMoney(run.requiredFirst),
    shortfall: unitsToMoney(run?.shortfall ?? 0n),
  }
  return {
    repaymentStartsOn: debt.repaymentStartsOn,
    repaymentStartMonth: debt.startMonth,
    compounding: debt.compounding,
    promo: planPromo,
  }
}

/** Summarises a simulation: how long, how much interest, and when it ends. */
function totalsOf(simulation: Simulation, dateOf: (month: number) => string): PlanTotals {
  const months = simulation.months.length
  const capped = simulation.capped !== null
  return {
    months,
    totalInterest: unitsToMoney(simulation.runs.reduce((sum, run) => sum + run.interest, 0n)),
    // Nothing owed at the start is "debt free" on the start date, which is month 0.
    debtFreeDate: capped ? null : dateOf(months),
    capped,
  }
}
