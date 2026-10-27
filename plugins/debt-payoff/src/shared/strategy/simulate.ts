import { BALANCE_CEILING_UNITS } from './BALANCE_CEILING_UNITS.js'
import type { CapReason } from './CapReason.js'
import { MAX_PLAN_MONTHS } from './MAX_PLAN_MONTHS.js'
import { monthlyInterest } from './monthlyInterest.js'
import { periodInterest } from './periodInterest.js'
import type { ParsedDebt } from './ParsedDebt.js'

/** One debt's running figures while a simulation runs. */
export interface DebtRun {
  readonly debt: ParsedDebt
  /** What is owed now. */
  balance: bigint
  /** Interest accrued so far. */
  interest: bigint
  /** Paid so far. */
  paid: bigint
  /** The month it reached zero, or `null` while it has not. */
  payoffMonth: number | null
  /** Backdated-interest shadow: what would be charged if the promotion ended unpaid. Not part of the balance. */
  shadow: bigint
  /** Backdated interest actually added to the balance when the promotion ended unpaid. */
  backdated: bigint
  /** The payment the promotion needed in the first month it applied, or `null`. */
  requiredFirst: bigint | null
  /** What the promotion needed in its first month that the budget could not cover: the extra a month that would clear it in time. */
  shortfall: bigint
}

/** One debt's figures for one simulated month, in units. */
export interface RunDebtMonth {
  readonly run: DebtRun
  readonly interest: bigint
  readonly payment: bigint
  readonly balance: bigint
}

/** One simulated month, in units. */
export interface RunMonth {
  readonly month: number
  readonly interest: bigint
  readonly payment: bigint
  readonly balance: bigint
  readonly debts: readonly RunDebtMonth[]
}

/** What a simulation produced. */
export interface Simulation {
  /** Every debt's final figures, in the order given. */
  readonly runs: readonly DebtRun[]
  /** One entry per month simulated. */
  readonly months: readonly RunMonth[]
  /** Why it stopped short, or `null` if everything was paid. */
  readonly capped: CapReason | null
}

/** What to simulate. */
export interface SimulationInput {
  /** Debts with a balance, highest priority first. */
  readonly debts: readonly ParsedDebt[]
  /** Paid every month above the minimums, in units. Ignored unless `rollover` is set. */
  readonly extra: bigint
  /**
   * Whether the money is pooled. With it, one amount is paid every month (the
   * sum of the minimums plus the extra), each debt takes its own minimum, and
   * everything else goes to the highest-priority debt that still has a
   * balance, so a paid-off debt's minimum is aimed at the next one. Without
   * it, each debt gets only its own minimum and nothing moves between them.
   */
  readonly rollover: boolean
  /** The number of days in plan month `n` (1 is the first), which the daily compounding options need. */
  readonly daysIn: (month: number) => number
}

/**
 * Runs the payoff month by month.
 *
 * Each month, for every debt with a balance:
 *
 * 1. **Interest accrues** on the opening balance (see {@link periodInterest}
 *    and {@link monthlyInterest}), at the promotional rate while one applies.
 * 2. **The minimum is paid**, but never more than the debt now owes, so a
 *    minimum larger than the balance clears it and leaves nothing negative.
 *    A deferred debt owes no minimum until its start month.
 * 3. **With `rollover`, each debt's earmark is paid**, never more than the
 *    debt still owes. An earmark is outside the pool: it is not part of the
 *    pooled amount and nothing replaces it once its debt is paid off, so the
 *    money stops rather than moving to another debt.
 * 4. **With `rollover`, a promotion with deferred interest is topped up** from
 *    what is left of the pool (earliest deadline first) to the even payment
 *    that clears it by the promotion's last month, as far as the pool allows.
 *    If it still has a balance after that month, interest at the standard APR
 *    for the whole promotion is added to it.
 * 5. **With `rollover`**, whatever is left of the month's pooled amount is
 *    aimed down the priority list: the first debt takes up to what it owes,
 *    the next takes what remains, and so on. That one rule covers an extra
 *    payment, a freed minimum, and the leftover when a final payment is
 *    smaller than the minimum.
 *
 * The month a balance reaches zero is its payoff month. The run ends when
 * nothing is owed, or at {@link MAX_PLAN_MONTHS}, or when a balance reaches
 * {@link BALANCE_CEILING_UNITS}; the last two are reported as capped.
 *
 * Every figure is an exact integer except the interest, which is rounded once
 * per debt per month inside {@link monthlyInterest}.
 *
 * @param input - See {@link SimulationInput}.
 * @returns The schedule and each debt's totals.
 */
export function simulate(input: SimulationInput): Simulation {
  const runs: DebtRun[] = input.debts.map((debt) => ({
    debt, balance: debt.balance, interest: 0n, paid: 0n, payoffMonth: null,
    shadow: 0n, backdated: 0n, requiredFirst: null, shortfall: 0n,
  }))
  // The pooled amount: every minimum that is due (a deferred debt's joins in its
  // start month, a debt paid off before then never joins) plus the extra. With
  // no deferral this is the same sum every month, as it always was.
  const poolFor = (month: number): bigint => input.rollover
    ? runs.reduce((sum, run) => {
        const { startMonth, minimum } = run.debt
        const due = startMonth <= month && (run.payoffMonth === null || run.payoffMonth >= startMonth)
        return due ? sum + minimum : sum
      }, 0n) + input.extra
    : 0n

  const months: RunMonth[] = []
  let capped: CapReason | null = null

  for (let month = 1; ; month += 1) {
    const open = runs.filter((run) => run.balance > 0n)
    if (open.length === 0) break
    if (month > MAX_PLAN_MONTHS) {
      capped = 'month_limit'
      break
    }
    if (open.some((run) => run.balance >= BALANCE_CEILING_UNITS)) {
      capped = 'balance_limit'
      break
    }

    const days = input.daysIn(month)
    const lines = open.map((run) => {
      const { debt } = run
      const promoActive = debt.promo !== null && month <= debt.promo.months
      if (debt.promo !== null && promoActive && debt.promo.deferredInterest) {
        run.shadow += monthlyInterest(debt.promo.base === 'original' ? debt.balance : run.balance, debt.apr)
      }
      const apr = debt.promo !== null && promoActive ? debt.promo.apr : debt.apr
      // Simple daily interest on a deferred loan is charged on what was owed at
      // the start less what has been paid, not on the interest added since.
      const base = debt.compounding === 'daily_simple' && month < debt.startMonth
        ? (debt.balance > run.paid ? debt.balance - run.paid : 0n)
        : run.balance
      const interest = periodInterest(debt.compounding, base, apr, days)
      run.balance += interest
      run.interest += interest
      return { run, interest, payment: 0n, owed: run.balance }
    })

    let spent = 0n
    for (const line of lines) {
      if (month < line.run.debt.startMonth) continue
      const payment = line.run.debt.minimum < line.run.balance ? line.run.debt.minimum : line.run.balance
      line.payment = payment
      line.run.balance -= payment
      spent += payment
    }

    if (input.rollover) {
      // Earmarks come first and are not drawn from the pool: `spent` stays the
      // minimums, so the pool's leftover below is unaffected by them.
      for (const line of lines) {
        const earmark = line.run.debt.extra < line.run.balance ? line.run.debt.extra : line.run.balance
        line.payment += earmark
        line.run.balance -= earmark
      }

      let left = poolFor(month) - spent

      const promos = lines
        .filter((line) => {
          const { promo, startMonth } = line.run.debt
          return promo !== null && promo.deferredInterest && month >= startMonth && month <= promo.months
        })
        .sort((a, b) => (a.run.debt.promo?.months ?? 0) - (b.run.debt.promo?.months ?? 0))
      for (const line of promos) {
        const monthsLeft = BigInt((line.run.debt.promo?.months ?? month) - month + 1)
        const required = (line.owed + monthsLeft - 1n) / monthsLeft
        const first = line.run.requiredFirst === null
        line.run.requiredFirst ??= required
        const wanted = required > line.payment ? required - line.payment : 0n
        const need = wanted < line.run.balance ? wanted : line.run.balance
        const topUp = need < left ? need : left
        line.payment += topUp
        line.run.balance -= topUp
        left -= topUp
        if (first) line.run.shortfall = need - topUp
      }

      for (const line of lines) {
        if (left <= 0n) break
        if (month < line.run.debt.startMonth) continue
        const payment = left < line.run.balance ? left : line.run.balance
        line.payment += payment
        line.run.balance -= payment
        left -= payment
      }
    }

    let backdated = 0n
    for (const line of lines) {
      const { run } = line
      if (run.debt.promo?.deferredInterest === true && month === run.debt.promo.months && run.balance > 0n) {
        run.balance += run.shadow
        run.interest += run.shadow
        run.backdated = run.shadow
        backdated += run.shadow
      }
      run.paid += line.payment
      if (run.balance === 0n) run.payoffMonth = month
    }

    months.push({
      month,
      interest: lines.reduce((sum, line) => sum + line.interest, 0n) + backdated,
      payment: lines.reduce((sum, line) => sum + line.payment, 0n),
      balance: runs.reduce((sum, run) => sum + run.balance, 0n),
      debts: lines.map((line) => ({
        run: line.run,
        interest: line.interest + (line.run.backdated > 0n && month === line.run.debt.promo?.months ? line.run.backdated : 0n),
        payment: line.payment,
        balance: line.run.balance,
      })),
    })
  }

  return { runs, months, capped }
}
